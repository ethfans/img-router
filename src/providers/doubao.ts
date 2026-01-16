/**
 * Doubao（豆包）Provider 实现
 *
 * 基于火山引擎（Volcengine）API 实现。
 * 支持文生图和图生图（多图融合）功能。
 * 特点：
 * 1. 使用 UUID 格式的 API Key。
 * 2. 强大的中文理解能力。
 * 3. 支持多图融合，并内置了 Prompt 智能重写功能，优化多图引用。
 */

import {
  BaseProvider,
  type GenerationOptions,
  type ProviderCapabilities,
  type ProviderConfig,
} from "./base.ts";
import type { GenerationResult, ImageGenerationRequest } from "../types/index.ts";
import { DoubaoConfig } from "../config/manager.ts";
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
 * 
 * 封装了与火山引擎视觉大模型 API 的交互逻辑。
 */
export class DoubaoProvider extends BaseProvider {
  /** Provider 名称标识 */
  readonly name = "Doubao" as const;

  /**
   * Provider 能力描述
   * 定义了该 Provider 支持的功能特性和限制。
   */
  readonly capabilities: ProviderCapabilities = {
    textToImage: true,      // 支持文生图
    imageToImage: true,     // 支持图生图
    multiImageFusion: true, // 支持多图融合
    asyncTask: false,       // 仅支持同步任务
    maxInputImages: 3,      // 最多支持 3 张参考图
    outputFormats: ["url", "b64_json"], // 支持 URL 和 Base64 输出
  };

  /**
   * Provider 配置信息
   * 从全局配置管理器加载默认配置。
   */
  readonly config: ProviderConfig = {
    apiUrl: DoubaoConfig.apiUrl,
    supportedModels: DoubaoConfig.supportedModels,
    defaultModel: DoubaoConfig.defaultModel,
    defaultSize: DoubaoConfig.defaultSize,
    editModels: DoubaoConfig.supportedModels, // 豆包的模型通常通用，图生图也用相同列表
    defaultEditModel: DoubaoConfig.defaultModel,
    defaultEditSize: DoubaoConfig.defaultEditSize,
  };

  /**
   * 检测 API Key 是否属于 Doubao
   * Doubao 使用标准的 UUID 格式 API Key (例如：550e8400-e29b-41d4-a716-446655440000)
   *
   * @param apiKey - 待检测的 API Key
   * @returns 如果格式匹配返回 true，否则返回 false
   */
  detectApiKey(apiKey: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(apiKey);
  }

  /**
   * 执行图片生成请求
   * 
   * 处理流程：
   * 1. 解析请求参数（模型、尺寸、Prompt）。
   * 2. 如果是多图融合任务，执行 Prompt 智能重写（将"这张图"替换为明确的"图1"、"图2"）。
   * 3. 构建火山引擎 API 请求体。
   * 4. 发送 HTTP 请求并处理响应。
   * 5. 将结果转换为统一的 GenerationResult 格式（尝试将 URL 转为 Base64 以实现持久化）。
   *
   * @param apiKey - 认证密钥
   * @param request - 图片生成请求对象
   * @param options - 生成选项（包含 requestId 等）
   * @returns 生成结果 Promise
   */
  async generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const hasImages = request.images.length > 0;
    // 区分 API 接口类型用于计时统计
    const apiType = hasImages ? "image_edit" : "generate_image";

    try {
      const processedImages = request.images;

      // 1. 智能选择模型和尺寸
      const model = this.selectModel(request.model, hasImages);
      const size = this.selectSize(request.size, hasImages);

      // 2. 针对豆包多图融合的特殊处理：智能重写 Prompt
      // 豆包的多图模式要求在 Prompt 中明确使用 "图1"、"图2" 来引用参考图。
      // 为了提升用户体验，这里自动将自然语言中的代词（如"这张图"）转换为明确的引用。
      let finalPrompt = request.prompt || "A beautiful scenery";
      if (processedImages.length > 1) {
        const originalPrompt = finalPrompt;
        finalPrompt = finalPrompt
          .replace(/这张图|这幅图|当前图/g, "图2")
          .replace(/上面那张|上面那个人|原图|背景图/g, "图1");

        // 如果 Prompt 中完全没有提及图片引用，尝试自动添加默认指令
        if (originalPrompt === finalPrompt && !finalPrompt.includes("图1")) {
          finalPrompt = `图1是背景，图2是主体。任务：${finalPrompt}`;
        }
        
        if (finalPrompt !== originalPrompt) {
          info("Doubao", `Prompt 已智能转换: "${originalPrompt}" -> "${finalPrompt}"`);
        }
      }

      // 3. 记录请求日志
      logFullPrompt("Doubao", options.requestId, finalPrompt);
      if (hasImages) logInputImages("Doubao", options.requestId, processedImages);
      logImageGenerationStart("Doubao", options.requestId, model, size, finalPrompt.length);

      // 4. 构建火山引擎 API 请求体
      const arkRequest = {
        model,
        prompt: finalPrompt,
        // 优先请求 Base64 格式，减少后续转换开销
        response_format: options.returnBase64 ? "b64_json" : "url",
        size,
        watermark: true, // 默认开启水印
        ...(hasImages
          ? {
            image: processedImages, // 图生图/多图融合的输入图片列表
            sequential_image_generation: "disabled", // 禁用连续生成模式
          }
          : {}),
      };

      // 5. 发送请求（使用计时中间件）
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

      // 6. 结果处理：确保返回 Base64 数据
      // 即使 API 返回了 URL，我们也尝试将其下载并转换为 Base64，
      // 这样可以避免临时 URL 过期的问题，实现生成的图片永久保存。
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
