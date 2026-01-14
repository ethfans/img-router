/**
 * Doubao（豆包）Provider 实现
 *
 * 支持文生图和图生图（多图融合）功能
 */

import {
  BaseProvider,
  type GenerationOptions,
  type ProviderCapabilities,
  type ProviderConfig,
} from "./base.ts";
import type { GenerationResult, ImageGenerationRequest } from "../types/index.ts";
import { DoubaoConfig } from "../config/index.ts";
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
 * Doubao Provider 实现类
 */
export class DoubaoProvider extends BaseProvider {
  readonly name = "Doubao" as const;

  readonly capabilities: ProviderCapabilities = {
    textToImage: true,
    imageToImage: true,
    multiImageFusion: true,
    asyncTask: false,
    maxInputImages: 3,
    outputFormats: ["url", "b64_json"],
  };

  readonly config: ProviderConfig = {
    apiUrl: DoubaoConfig.apiUrl,
    supportedModels: DoubaoConfig.supportedModels,
    defaultModel: DoubaoConfig.defaultModel,
    defaultSize: DoubaoConfig.defaultSize,
    editModels: DoubaoConfig.supportedModels,
    defaultEditModel: DoubaoConfig.defaultModel,
    defaultEditSize: DoubaoConfig.defaultEditSize,
  };

  /**
   * 检测 API Key 是否属于 Doubao
   * Doubao 使用 UUID 格式的 API Key
   */
  detectApiKey(apiKey: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(apiKey);
  }

  /**
   * 生成图片
   */
  async generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const hasImages = request.images.length > 0;
    const apiType = hasImages ? "image_edit" : "generate_image";

    try {
      const processedImages = request.images;

      // 选择模型和尺寸
      const model = this.selectModel(request.model, hasImages);
      const size = this.selectSize(request.size, hasImages);

      // 针对豆包多图融合的特殊处理：智能重写 Prompt，将口语化描述转换为明确的"图n"引用
      let finalPrompt = request.prompt || "A beautiful scenery";
      if (processedImages.length > 1) {
        const originalPrompt = finalPrompt;
        finalPrompt = finalPrompt
          .replace(/这张图|这幅图|当前图/g, "图2")
          .replace(/上面那张|上面那个人|原图|背景图/g, "图1");

        if (originalPrompt === finalPrompt && !finalPrompt.includes("图1")) {
          finalPrompt = `图1是背景，图2是主体。任务：${finalPrompt}`;
        }
        if (finalPrompt !== originalPrompt) {
          info("Doubao", `Prompt 已智能转换: "${originalPrompt}" -> "${finalPrompt}"`);
        }
      }

      logFullPrompt("Doubao", options.requestId, finalPrompt);
      if (hasImages) logInputImages("Doubao", options.requestId, processedImages);
      logImageGenerationStart("Doubao", options.requestId, model, size, finalPrompt.length);

      // 构建请求体
      const arkRequest = {
        model,
        prompt: finalPrompt,
        response_format: options.returnBase64 ? "b64_json" : "url",
        size,
        watermark: true,
        ...(hasImages
          ? {
            image: processedImages,
            sequential_image_generation: "disabled",
          }
          : {}),
      };

      // 发送请求（使用计时中间件）
      const response = await withApiTiming("Doubao", apiType, () =>
        fetchWithTimeout(
          this.config.apiUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              "Connection": "close",
            },
            body: JSON.stringify(arkRequest),
          },
          options.timeoutMs,
        ));

      if (!response.ok) {
        const errorText = await response.text();
        const friendlyError = parseErrorMessage(errorText, response.status, "Doubao");
        logImageGenerationFailed("Doubao", options.requestId, friendlyError);
        throw new Error(friendlyError);
      }

      const data = await response.json();
      logGeneratedImages("Doubao", options.requestId, data.data || []);

      const duration = Date.now() - startTime;
      const imageData = data.data || [];
      logImageGenerationComplete("Doubao", options.requestId, imageData.length, duration);

      // 核心改进：将生成的图片 URL 转换回 Base64，确保客户端能够永久保存图片
      const images: Array<{ url?: string; b64_json?: string }> = await Promise.all(
        imageData.map(async (img: { url?: string; b64_json?: string }) => {
          if (img.b64_json) {
            return { b64_json: img.b64_json };
          }
          if (img.url) {
            try {
              info("Doubao", `正在将生成结果 URL 转换为 Base64 以供永久保存...`);
              const { base64, mimeType } = await urlToBase64(img.url);
              return { b64_json: base64, mimeType };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              warn("Doubao", `结果转换 Base64 失败，回退到 URL: ${msg}`);
              return { url: img.url };
            }
          }
          return {};
        }),
      );

      return {
        success: true,
        images: images.filter((img) => img.url || img.b64_json),
        model,
        provider: "Doubao",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: errorMessage,
        model: request.model || this.config.defaultModel,
        provider: "Doubao",
      };
    }
  }
}

// 导出单例实例
export const doubaoProvider = new DoubaoProvider();
