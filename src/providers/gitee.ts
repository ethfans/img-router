/**
 * Gitee（模力方舟）Provider 实现
 *
 * 支持文生图、图片编辑（同步）、图片编辑（异步）三种模式
 */

import {
  BaseProvider,
  type GenerationOptions,
  type ProviderCapabilities,
  type ProviderConfig,
} from "./base.ts";
import type { GenerationResult, ImageData, ImageGenerationRequest } from "../types/index.ts";
import { GiteeConfig } from "../config/index.ts";
import { fetchWithTimeout, urlToBase64 } from "../utils/index.ts";
import { parseErrorMessage } from "../core/error-handler.ts";
import {
  info,
  logFullPrompt,
  logGeneratedImages,
  logImageGenerationComplete,
  logImageGenerationFailed,
  logImageGenerationStart,
  logInputImages,
  warn,
} from "../core/logger.ts";
import { withApiTiming } from "../middleware/timing.ts";

/**
 * Gitee Provider 实现类
 */
export class GiteeProvider extends BaseProvider {
  readonly name = "Gitee" as const;

  readonly capabilities: ProviderCapabilities = {
    textToImage: true,
    imageToImage: true,
    multiImageFusion: true,
    asyncTask: true,
    maxInputImages: 5,
    outputFormats: ["url", "b64_json"],
  };

  readonly config: ProviderConfig = {
    apiUrl: GiteeConfig.apiUrl,
    supportedModels: GiteeConfig.supportedModels,
    defaultModel: GiteeConfig.defaultModel,
    defaultSize: GiteeConfig.defaultSize,
    editModels: [...GiteeConfig.editModels, ...GiteeConfig.asyncEditModels],
    defaultEditModel: GiteeConfig.defaultEditModel,
    defaultEditSize: GiteeConfig.defaultEditSize,
  };

  override detectApiKey(apiKey: string): boolean {
    const giteeRegex = /^[a-zA-Z0-9]{30,60}$/;
    return giteeRegex.test(apiKey);
  }

  override async generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const hasImages = request.images.length > 0;

    const normalizedRequest: ImageGenerationRequest = {
      ...request,
      model: this.resolveModelAlias(request.model, hasImages),
    };

    logFullPrompt("Gitee", options.requestId, normalizedRequest.prompt);

    if (hasImages) {
      logInputImages("Gitee", options.requestId, normalizedRequest.images);
    }

    const size = normalizedRequest.size ||
      (hasImages ? GiteeConfig.defaultEditSize : GiteeConfig.defaultSize);

    try {
      if (hasImages) {
        const isAsyncModel = normalizedRequest.model &&
          GiteeConfig.asyncEditModels.includes(normalizedRequest.model);

        if (isAsyncModel) {
          return await this.handleAsyncEdit(apiKey, normalizedRequest, options, startTime);
        } else {
          return await this.handleSyncEdit(apiKey, normalizedRequest, options, size, startTime);
        }
      } else {
        return await this.handleTextToImage(apiKey, normalizedRequest, options, size, startTime);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        error: errorMessage,
        model: normalizedRequest.model || this.config.defaultModel,
        provider: "Gitee",
      };
    }
  }

  private resolveModelAlias(model: string | undefined, hasImages: boolean): string | undefined {
    if (!model) return model;
    if (hasImages && model === "Qwen-Image-Edit") return GiteeConfig.defaultAsyncEditModel;
    return model;
  }

  private async handleTextToImage(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
    size: string,
    startTime: number,
  ): Promise<GenerationResult> {
    const model = this.selectModel(request.model, false);

    logImageGenerationStart("Gitee", options.requestId, model, size, request.prompt.length);
    info("Gitee", `使用文生图模式, 模型: ${model}`);

    const giteeRequest = {
      model,
      prompt: request.prompt,
      n: request.n || 1,
      size,
    };

    const response = await withApiTiming(
      "Gitee",
      "generate_image",
      () =>
        fetchWithTimeout(GiteeConfig.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(giteeRequest),
        }, options.timeoutMs),
    );

    if (!response.ok) {
      const errorText = await response.text();
      const friendlyError = parseErrorMessage(errorText, response.status, "Gitee");
      logImageGenerationFailed("Gitee", options.requestId, friendlyError);
      throw new Error(friendlyError);
    }

    const data = await response.json();
    const imageData: ImageData[] = data.data || [];

    if (!imageData || imageData.length === 0) {
      throw new Error("Gitee 返回数据为空");
    }

    logGeneratedImages("Gitee", options.requestId, imageData);

    const duration = Date.now() - startTime;
    logImageGenerationComplete("Gitee", options.requestId, imageData.length, duration);

    const images = await this.convertUrlsToBase64(imageData);

    return {
      success: true,
      images,
      model,
      provider: "Gitee",
    };
  }

  private async handleSyncEdit(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
    size: string,
    startTime: number,
  ): Promise<GenerationResult> {
    const model = this.selectModel(request.model, true);

    logImageGenerationStart("Gitee", options.requestId, model, size, request.prompt.length);
    info("Gitee", `使用图片编辑模式, 模型: ${model}, 图片数量: ${request.images.length}`);

    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", request.prompt || "");
    formData.append("size", GiteeConfig.defaultEditSize);
    formData.append("n", "1");

    for (let i = 0; i < request.images.length; i++) {
      const imageInput = request.images[i];
      let base64Data: string;
      let mimeType: string;

      if (imageInput.startsWith("data:")) {
        base64Data = imageInput.split(",")[1];
        mimeType = imageInput.split(";")[0].split(":")[1];
      } else {
        const downloaded = await urlToBase64(imageInput);
        base64Data = downloaded.base64;
        mimeType = downloaded.mimeType;
      }

      const blob = new Blob([Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))], {
        type: mimeType,
      });
      formData.append("image", blob, `image${i + 1}.png`);
    }

    const response = await withApiTiming(
      "Gitee",
      "image_edit",
      () =>
        fetchWithTimeout(GiteeConfig.editApiUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}` },
          body: formData,
        }, options.timeoutMs),
    );

    if (!response.ok) {
      const errorText = await response.text();
      const friendlyError = parseErrorMessage(errorText, response.status, "Gitee");
      logImageGenerationFailed("Gitee", options.requestId, friendlyError);
      throw new Error(friendlyError);
    }

    const data = await response.json();
    const imageData: ImageData[] = data.data || [];

    if (!imageData || imageData.length === 0) {
      throw new Error("Gitee 返回数据为空");
    }

    logGeneratedImages("Gitee", options.requestId, imageData);

    const duration = Date.now() - startTime;
    logImageGenerationComplete("Gitee", options.requestId, imageData.length, duration);

    const images = await this.convertUrlsToBase64(imageData);

    return {
      success: true,
      images,
      model,
      provider: "Gitee",
    };
  }

  private async handleAsyncEdit(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
    startTime: number,
  ): Promise<GenerationResult> {
    const model = request.model as string;
    const asyncSize = GiteeConfig.defaultAsyncEditSize;

    logImageGenerationStart("Gitee", options.requestId, model, asyncSize, request.prompt.length);
    info("Gitee", `使用图片编辑（异步）模式, 模型: ${model}, 图片数量: ${request.images.length}`);

    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", request.prompt || "");
    formData.append("size", asyncSize);
    formData.append("n", "1");
    formData.append("response_format", "url");

    for (let i = 0; i < request.images.length; i++) {
      const imageInput = request.images[i];
      let base64Data: string;
      let mimeType: string;

      if (imageInput.startsWith("data:")) {
        base64Data = imageInput.split(",")[1];
        mimeType = imageInput.split(";")[0].split(":")[1];
      } else {
        const downloaded = await urlToBase64(imageInput);
        base64Data = downloaded.base64;
        mimeType = downloaded.mimeType;
      }

      const blob = new Blob([Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))], {
        type: mimeType,
      });
      formData.append("image", blob, `image${i + 1}.png`);
    }

    const submitResponse = await withApiTiming(
      "Gitee",
      "image_edit_async_submit",
      () =>
        fetchWithTimeout(GiteeConfig.asyncEditApiUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
          body: formData,
        }, options.timeoutMs),
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      const friendlyError = parseErrorMessage(errorText, submitResponse.status, "Gitee");
      logImageGenerationFailed("Gitee", options.requestId, friendlyError);
      throw new Error(friendlyError);
    }

    const submitData = await submitResponse.json();
    const taskId = submitData.task_id;
    if (!taskId) throw new Error("Gitee 异步任务提交失败：未返回 task_id");

    info("Gitee", `异步任务已提交, Task ID: ${taskId}`);

    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const statusResponse = await fetchWithTimeout(`${GiteeConfig.taskStatusUrl}/${taskId}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}` },
      }, options.timeoutMs);

      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json();
      const status = statusData.status;

      if (status === "success") {
        const duration = Date.now() - startTime;
        const imageData: ImageData[] = [];
        const output = statusData.output ?? statusData.data;

        if (output?.file_url) {
          imageData.push({ url: output.file_url });
        } else if (output?.url) {
          imageData.push({ url: output.url });
        } else if (output?.b64_json) {
          const b64 = typeof output.b64_json === "string" && output.b64_json.startsWith("data:")
            ? output.b64_json.split(",")[1]
            : output.b64_json;
          imageData.push({ b64_json: b64 });
        } else if (Array.isArray(output)) {
          for (const item of output) {
            if (item?.file_url) imageData.push({ url: item.file_url });
            else if (item?.url) imageData.push({ url: item.url });
            else if (item?.b64_json) imageData.push({ b64_json: item.b64_json });
          }
        } else if (output?.data?.file_url) {
          imageData.push({ url: output.data.file_url });
        } else if (output?.data?.url) {
          imageData.push({ url: output.data.url });
        } else if (output?.data?.b64_json) {
          imageData.push({ b64_json: output.data.b64_json });
        }

        if (imageData.length === 0) {
          throw new Error("Gitee 异步任务成功但无图片数据");
        }

        logImageGenerationComplete("Gitee", options.requestId, 1, duration);

        const images = await this.convertUrlsToBase64(imageData);

        return {
          success: true,
          images,
          model,
          provider: "Gitee",
        };
      } else if (status === "failure" || status === "cancelled") {
        logImageGenerationFailed("Gitee", options.requestId, status);
        throw new Error(`Gitee 异步任务${status === "failure" ? "失败" : "已取消"}`);
      }
    }

    logImageGenerationFailed("Gitee", options.requestId, "任务超时");
    throw new Error("Gitee 异步任务超时");
  }

  private async convertUrlsToBase64(imageData: ImageData[]): Promise<ImageData[]> {
    const results: ImageData[] = [];

    for (const img of imageData) {
      if (img.b64_json) {
        results.push({ b64_json: img.b64_json });
      } else if (img.url) {
        try {
          info("Gitee", `正在将 URL 转换为 Base64 以供永久保存...`);
          const { base64 } = await urlToBase64(img.url);
          results.push({ b64_json: base64 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          warn("Gitee", `URL 转换 Base64 失败，回退到 URL: ${msg}`);
          results.push({ url: img.url });
        }
      }
    }

    return results;
  }
}

// 导出单例实例
export const giteeProvider = new GiteeProvider();
