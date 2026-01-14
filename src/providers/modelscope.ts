/**
 * ModelScope（魔搭）Provider 实现
 * 支持文生图（异步轮询）和图生图（多图融合）
 */

import {
  BaseProvider,
  type GenerationOptions,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderName,
} from "./base.ts";
import type { GenerationResult, ImageGenerationRequest } from "../types/index.ts";
import { ModelScopeConfig } from "../config/index.ts";
import { base64ToUrl, fetchWithTimeout } from "../utils/index.ts";
import { buildDataUri, urlToBase64 } from "../utils/image.ts";
import {
  debug,
  error,
  info,
  logFullPrompt,
  logGeneratedImages,
  logImageGenerationComplete,
  logImageGenerationFailed,
  logImageGenerationStart,
  logInputImages,
  warn,
} from "../core/logger.ts";
import { parseErrorMessage } from "../core/error-handler.ts";
import { withApiTiming } from "../middleware/timing.ts";

export class ModelScopeProvider extends BaseProvider {
  readonly name: ProviderName = "ModelScope";

  readonly capabilities: ProviderCapabilities = {
    textToImage: true,
    imageToImage: true,
    multiImageFusion: true,
    asyncTask: true,
    maxInputImages: 10,
    outputFormats: ["url", "b64_json"],
  };

  readonly config: ProviderConfig = {
    apiUrl: ModelScopeConfig.apiUrl,
    supportedModels: ModelScopeConfig.supportedModels,
    defaultModel: ModelScopeConfig.defaultModel,
    defaultSize: ModelScopeConfig.defaultSize,
    editModels: ModelScopeConfig.editModels,
    defaultEditModel: ModelScopeConfig.defaultEditModel,
    defaultEditSize: ModelScopeConfig.defaultEditSize,
  };

  override detectApiKey(apiKey: string): boolean {
    return apiKey.startsWith("ms-");
  }

  override async generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const { requestId } = options;
    const hasImages = request.images && request.images.length > 0;
    const apiType = hasImages ? "image_edit" : "generate_image";
    const prompt = request.prompt || "";
    const images = request.images || [];

    logFullPrompt("ModelScope", requestId, prompt);
    if (hasImages) logInputImages("ModelScope", requestId, images);

    // 智能选择模型
    const model = this.selectModel(request.model, hasImages);
    const size = this.selectSize(request.size, hasImages);

    if (hasImages) {
      info("ModelScope", `使用图生图模式, 模型: ${model}, 图片数量: ${images.length}`);
    } else {
      info("ModelScope", `使用文生图模式, 模型: ${model}`);
    }

    logImageGenerationStart("ModelScope", requestId, model, size, prompt.length);

    interface ModelScopeRequest {
      model: string;
      prompt: string;
      size?: string;
      n?: number;
      image_url?: string[];
    }

    const requestBody: ModelScopeRequest = {
      model: model,
      prompt: prompt || "A beautiful scenery",
    };

    if (!hasImages) {
      requestBody.size = size;
      requestBody.n = 1;
    }

    if (hasImages) {
      const urlImages: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.startsWith("http")) {
          urlImages.push(img);
          continue;
        }

        const dataUri = img.startsWith("data:") ? img : buildDataUri(img, "image/png");
        try {
          const imageUrl = await base64ToUrl(dataUri);
          urlImages.push(imageUrl);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const errMsg = `第${i + 1}张输入图片上传图床失败: ${msg}`;
          logImageGenerationFailed("ModelScope", requestId, errMsg);
          return { success: false, error: errMsg, duration: Date.now() - startTime };
        }
      }

      if (urlImages.length === 0) {
        const errMsg = "图生图失败：无可用输入图片 URL";
        logImageGenerationFailed("ModelScope", requestId, errMsg);
        return { success: false, error: errMsg, duration: Date.now() - startTime };
      }

      requestBody.image_url = urlImages;
      info("ModelScope", `发送 ${urlImages.length} 张图片 URL 给魔搭 API:`);
      urlImages.forEach((url, index) => {
        info("ModelScope", `  ${index + 1}. ${url} (成功)`);
      });
    }

    const submit = (body: ModelScopeRequest): Promise<Response> =>
      withApiTiming(
        "ModelScope",
        apiType,
        () =>
          fetchWithTimeout(`${ModelScopeConfig.apiUrl}/images/generations`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              "X-ModelScope-Async-Mode": "true",
            },
            body: JSON.stringify(body),
          }),
      );

    const submitResponse = await submit(requestBody);
    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      const friendlyError = parseErrorMessage(errorText, submitResponse.status, "ModelScope");
      logImageGenerationFailed("ModelScope", requestId, friendlyError);
      return {
        success: false,
        error: friendlyError,
        duration: Date.now() - startTime,
      };
    }

    const submitData: { task_id?: unknown; [key: string]: unknown } = await submitResponse.json();

    const taskId = typeof submitData.task_id === "string"
      ? submitData.task_id
      : (typeof submitData.task_id === "number" && Number.isFinite(submitData.task_id))
      ? String(submitData.task_id)
      : "";
    if (!taskId) {
      const errMsg = "ModelScope 任务提交失败：未返回 task_id";
      logImageGenerationFailed("ModelScope", requestId, errMsg);
      return { success: false, error: errMsg, duration: Date.now() - startTime };
    }

    info("ModelScope", `任务已提交, Task ID: ${taskId}`);

    // 轮询任务状态
    const maxAttempts = 120; // 10分钟超时 (120次 × 5秒)
    let pollingAttempts = 0;
    let invalidResponseStreak = 0;

    const normalizeTaskData = (raw: unknown): Record<string, unknown> | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;

      // 只要有 task_status 就视为有效响应
      // ModelScope 的 image_generation 接口在查询 image_edit 任务时，
      // 可能会在 PENDING 阶段返回 task_id 为空的响应，这是正常现象，必须接受，否则会误判为失败。
      if (typeof r.task_status === "string") return r;

      const nested = r.data ?? r.Data;
      if (nested && typeof nested === "object") {
        const n = nested as Record<string, unknown>;
        if (typeof n.task_status === "string") return n;
      }

      return null;
    };

    const extractOutputImages = (data: Record<string, unknown>): string[] => {
      const direct = data.output_images;
      if (Array.isArray(direct)) {
        return direct.filter((v): v is string => typeof v === "string" && v.length > 0);
      }

      const outputs = data.outputs;
      if (outputs && typeof outputs === "object") {
        const out = outputs as Record<string, unknown>;
        const nested = out.output_images;
        if (Array.isArray(nested)) {
          return nested.filter((v): v is string => typeof v === "string" && v.length > 0);
        }
      }

      return [];
    };

    // 优先使用 image_generation，因为绝大多数图生图任务也使用此类型查询
    // video_generation 作为备选，防止某些特殊模型被归类为视频
    const taskTypeOrder: Array<string | undefined> = ["image_generation", "video_generation"];

    let lastPollError: string | null = null;

    const getTaskStatus = async (taskType?: string): Promise<Record<string, unknown> | null> => {
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${apiKey}`,
      };
      if (taskType) {
        headers["X-ModelScope-Task-Type"] = taskType;
      }

      const url = new URL(`${ModelScopeConfig.apiUrl}/tasks/${taskId}`);

      const checkResponse = await fetchWithTimeout(url.toString(), {
        method: "GET",
        headers,
      });

      if (!checkResponse.ok) {
        const errorText = await checkResponse.text();
        lastPollError = `HTTP ${checkResponse.status}(${taskType ?? "default"}): ${errorText.substring(0, 200)}`;
        warn("ModelScope", `轮询失败 (${checkResponse.status}): ${errorText}`);
        return null;
      }

      const json = (await checkResponse.json()) as unknown;
      const normalized = normalizeTaskData(json);
      if (!normalized) {
        lastPollError = `异常响应(${taskType ?? "default"}): ${JSON.stringify(json).substring(0, 200)}`;
        if (pollingAttempts <= 3 || pollingAttempts % 10 === 0) {
          debug(
            "ModelScope",
            `⚠️ 轮询返回疑似异常响应: ${JSON.stringify(json).substring(0, 200)}`,
          );
        }
        return null;
      }

      return normalized;
    };

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      pollingAttempts++;

      let checkData: Record<string, unknown> | null = null;
      for (const taskType of taskTypeOrder) {
        checkData = await getTaskStatus(taskType);
        if (checkData) {
          if (pollingAttempts <= 1) {
             info("ModelScope", `✅ 成功连接任务状态，使用类型: ${taskType ?? "default"}`);
          }
          break;
        }
      }

      if (!checkData) {
        invalidResponseStreak++;
        if (invalidResponseStreak >= 6) {
          const errMsg = `ModelScope 任务状态查询返回异常：${lastPollError ?? "可能任务类型不匹配或任务不存在"}`;
          logImageGenerationFailed("ModelScope", requestId, errMsg);
          return {
            success: false,
            error: errMsg,
            duration: Date.now() - startTime,
          };
        }
        continue;
      }

      invalidResponseStreak = 0;

      if (pollingAttempts <= 3 || pollingAttempts % 10 === 0) {
        info(
          "ModelScope",
          `📊 轮询响应 (第${pollingAttempts}次): ${JSON.stringify(checkData).substring(0, 200)}`,
        );
      }

      const status = checkData.task_status;

      if (status === "SUCCEED") {
        const outputImageUrls = extractOutputImages(checkData);

        const imageData = outputImageUrls.map((url: string) => ({ url }));
        logGeneratedImages("ModelScope", requestId, imageData);

        const duration = Date.now() - startTime;
        const imageCount = outputImageUrls.length;
        logImageGenerationComplete("ModelScope", requestId, imageCount, duration);

        // 转换为 Base64 实现永久保存
        const results: Array<{ url?: string; b64_json?: string }> = [];
        for (const url of outputImageUrls) {
          info("ModelScope", `📎 原始图片 URL: ${url}`);
          info("ModelScope", `正在下载图片并转换为 Base64...`);
          try {
            const { base64, mimeType } = await urlToBase64(url);
            const sizeKB = Math.round(base64.length / 1024);
            info("ModelScope", `✅ 图片已转换为 Base64, MIME: ${mimeType}, 大小: ${sizeKB}KB`);
            results.push({ b64_json: base64 });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            warn("ModelScope", `❌ 图片转换 Base64 失败，使用 URL: ${msg}`);
            results.push({ url });
          }
        }

        info("ModelScope", `任务成功完成, 耗时: ${pollingAttempts}次轮询`);

        return {
          success: true,
          images: results,
          duration,
        };
      } else if (status === "FAILED") {
        error("ModelScope", "任务失败");
        const failReason = checkData.errors || checkData.error || checkData.message || JSON.stringify(checkData);
        logImageGenerationFailed("ModelScope", requestId, `Task Failed: ${failReason}`);
        return {
          success: false,
          error: `ModelScope Task Failed: ${failReason}`,
          duration: Date.now() - startTime,
        };
      } else {
        debug("ModelScope", `状态: ${status} (第${i + 1}次)`);
      }
    }

    error("ModelScope", "任务超时");
    logImageGenerationFailed("ModelScope", requestId, "任务超时");
    return {
      success: false,
      error: "ModelScope Task Timeout",
      duration: Date.now() - startTime,
    };
  }
}

// 导出单例实例
export const modelScopeProvider = new ModelScopeProvider();
