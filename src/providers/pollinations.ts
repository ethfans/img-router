/**
 * Pollinations Provider 实现
 *
 * 支持文生图和图生图功能，使用 GET 端点
 */

import { encodeBase64 } from "@std/encoding/base64";
import {
  BaseProvider,
  type GenerationOptions,
  type ProviderCapabilities,
  type ProviderConfig,
} from "./base.ts";
import type { GenerationResult, ImageData, ImageGenerationRequest } from "../types/index.ts";
import { API_TIMEOUT_MS, ImageBedConfig, PollinationsConfig } from "../config/index.ts";
import { fetchWithTimeout } from "../utils/http.ts";
import { error, info, warn } from "../core/logger.ts";
import { parseErrorMessage } from "../core/error-handler.ts";
import {
  logFullPrompt,
  logGeneratedImages,
  logImageGenerationComplete,
  logImageGenerationFailed,
  logImageGenerationStart,
  logInputImages,
} from "../core/logger.ts";
import { withApiTiming } from "../middleware/timing.ts";

/**
 * 根据图片魔数检测 MIME 类型
 */
function detectImageMimeType(uint8Array: Uint8Array): string | null {
  if (uint8Array.length < 4) return null;
  if (
    uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E &&
    uint8Array[3] === 0x47
  ) return "image/png";
  if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8 && uint8Array[2] === 0xFF) {
    return "image/jpeg";
  }
  if (
    uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 &&
    uint8Array[3] === 0x38
  ) return "image/gif";
  if (
    uint8Array[0] === 0x52 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 &&
    uint8Array[3] === 0x46 &&
    uint8Array.length > 11 && uint8Array[8] === 0x57 && uint8Array[9] === 0x45 &&
    uint8Array[10] === 0x42 && uint8Array[11] === 0x50
  ) return "image/webp";
  if (uint8Array[0] === 0x42 && uint8Array[1] === 0x4D) return "image/bmp";
  return null;
}

/**
 * 将Base64 图片上传到图床获取 URL
 */
async function uploadBase64ToImageBed(base64Data: string): Promise<string> {
  let base64Content: string;
  let mimeType: string;

  if (base64Data.startsWith("data:image/")) {
    const parts = base64Data.split(",");
    base64Content = parts[1];
    mimeType = parts[0].split(";")[0].split(":")[1];
  } else {
    base64Content = base64Data;
    mimeType = "image/png";
  }

  const binaryData = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));
  const blob = new Blob([binaryData], { type: mimeType });

  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  const ext = extMap[mimeType] || "png";
  const filename = `img_${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append("file", blob, filename);

  const uploadUrl = new URL(ImageBedConfig.uploadEndpoint, ImageBedConfig.baseUrl);
  uploadUrl.searchParams.set("uploadChannel", ImageBedConfig.uploadChannel);
  uploadUrl.searchParams.set("uploadFolder", ImageBedConfig.uploadFolder);
  uploadUrl.searchParams.set("returnFormat", "full");

  info(
    "Pollinations",
    `正在上传图片到图床: ${filename} (${Math.round(binaryData.length / 1024)}KB)`,
  );

  const response = await fetchWithTimeout(uploadUrl.toString(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ImageBedConfig.authCode}`,
    },
    body: formData,
  }, 60000);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`图床上传失败 (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  if (!result || !Array.isArray(result) || result.length === 0 || !result[0].src) {
    throw new Error(`图床返回格式异常: ${JSON.stringify(result)}`);
  }

  let imageUrl = result[0].src;
  if (!imageUrl.startsWith("http")) {
    imageUrl = `${ImageBedConfig.baseUrl}${imageUrl}`;
  }

  info("Pollinations", `✅ 图片上传成功: ${imageUrl}`);
  return imageUrl;
}

/**
 * Pollinations Provider
 */
export class PollinationsProvider extends BaseProvider {
  readonly name = "Pollinations" as const;

  readonly capabilities: ProviderCapabilities = {
    textToImage: true,
    imageToImage: true,
    multiImageFusion: true,
    asyncTask: false,
    maxInputImages: 3,
    outputFormats: ["b64_json"],
  };

  readonly config: ProviderConfig = {
    apiUrl: PollinationsConfig.apiUrl,
    supportedModels: PollinationsConfig.supportedModels,
    defaultModel: PollinationsConfig.defaultModel,
    defaultSize: PollinationsConfig.defaultSize,
    editModels: PollinationsConfig.editModels,
    defaultEditModel: PollinationsConfig.defaultEditModel,
    defaultEditSize: PollinationsConfig.defaultEditSize,
  };

  override detectApiKey(apiKey: string): boolean {
    return apiKey.startsWith("pk_") || apiKey.startsWith("sk_");
  }

  override async generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const hasImages = request.images.length > 0;

    logFullPrompt("Pollinations", options.requestId, request.prompt);

    if (hasImages) {
      logInputImages("Pollinations", options.requestId, request.images);
    }

    const model = this.selectModel(request.model, hasImages);
    const size = this.selectSize(request.size, hasImages);
    logImageGenerationStart("Pollinations", options.requestId, model, size, request.prompt.length);

    try {
      let base64Data: string;

      if (hasImages) {
        base64Data = await this.imageEdit(apiKey, request.prompt, request.images, model, size);
      } else {
        base64Data = await this.textToImage(apiKey, request.prompt, model, size);
      }

      const duration = Date.now() - startTime;
      // 从 data URI 中提取纯 Base64
      let pureBase64 = base64Data;
      if (base64Data.startsWith("data:")) {
        pureBase64 = base64Data.split(",")[1];
      }

      const imageData: ImageData = {
        b64_json: pureBase64,
      };

      logGeneratedImages("Pollinations", options.requestId, [{
        b64_json: pureBase64.substring(0, 100) + "...",
      }]);
      logImageGenerationComplete("Pollinations", options.requestId, 1, duration);

      return {
        success: true,
        images: [imageData],
        model,
        provider: this.name,
        duration,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const duration = Date.now() - startTime;
      logImageGenerationFailed("Pollinations", options.requestId, msg);
      return {
        success: false,
        error: msg,
        provider: this.name,
        duration,
      };
    }
  }

  private async textToImage(
    apiKey: string,
    prompt: string,
    model: string,
    size: string,
  ): Promise<string> {
    const { width, height } = this.parseSize(size);

    const encodedPrompt = encodeURIComponent(prompt || "A beautiful scenery");
    const url = `${PollinationsConfig.apiUrl}${PollinationsConfig.imageEndpoint}/${encodedPrompt}`;

    const params = new URLSearchParams({
      model,
      width: String(width),
      height: String(height),
    });

    if (PollinationsConfig.seed !== undefined) params.set("seed", String(PollinationsConfig.seed));
    if (PollinationsConfig.quality !== undefined) {
      params.set("quality", String(PollinationsConfig.quality));
    }
    if (PollinationsConfig.transparent) params.set("transparent", "true");
    if (PollinationsConfig.guidanceScale !== undefined) {
      params.set("guidance_scale", String(PollinationsConfig.guidanceScale));
    }
    if (PollinationsConfig.nologo) params.set("nologo", "true");
    if (PollinationsConfig.enhance) params.set("enhance", "true");
    if (PollinationsConfig.negativePrompt) {
      params.set("negative_prompt", PollinationsConfig.negativePrompt);
    }
    if (PollinationsConfig.private) params.set("private", "true");
    if (PollinationsConfig.nofeed) params.set("nofeed", "true");
    if (PollinationsConfig.safe) params.set("safe", "true");
    const fullUrl = `${url}?${params.toString()}`;

    info("Pollinations", `请求 URL: ${fullUrl.substring(0, 100)}...`);

    const response = await withApiTiming(
      "Pollinations",
      "generate_image",
      () =>
        fetchWithTimeout(fullUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }, API_TIMEOUT_MS),
    );

    if (!response.ok) {
    const errorText = await response.text();
    error("Pollinations", `API 请求失败 (${response.status}): ${errorText.substring(0, 1000)}`);
    const friendlyError = parseErrorMessage(errorText, response.status, "Pollinations");
    throw new Error(friendlyError);
  }

    // GET 端点直接返回图片二进制，转换为 Base64
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    let mimeType = detectImageMimeType(uint8Array);
    if (!mimeType) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.startsWith("image/")) {
        mimeType = contentType.split(";")[0].trim();
      } else {
        mimeType = "image/png";
      }
    }

    const base64 = encodeBase64(uint8Array);
    return `data:${mimeType};base64,${base64}`;
  }

  private async imageEdit(
    apiKey: string,
    prompt: string,
    images: string[],
    model: string,
    size: string,
  ): Promise<string> {
    let actualModel = model;
    if (!PollinationsConfig.editModels.includes(model)) {
      info(
        "Pollinations",
        `模型 ${model} 不支持图生图，切换到 ${PollinationsConfig.defaultEditModel}`,
      );
      actualModel = PollinationsConfig.defaultEditModel;
    }

    const { width, height } = this.parseSize(size);

    const processedImageUrls: string[] = [];
    for (const img of images) {
      if (img.startsWith("data:image/")) {
        warn("Pollinations", "检测到 Base64 图片，正在上传到图床以避免 URL 过长...");
        try {
          const shortUrl = await uploadBase64ToImageBed(img);
          processedImageUrls.push(shortUrl);
          info("Pollinations", `✅ Base64 图片已转换为短 URL: ${shortUrl.substring(0, 60)}...`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          error("Pollinations", `❌ 图片上传失败: ${msg}`);
          throw new Error("图片处理失败：无法上传到图床。请使用较小的图片或直接提供图片 URL。");
        }
      } else if (img.startsWith("http")) {
        processedImageUrls.push(img);
      } else {
        warn("Pollinations", "检测到纯 Base64 图片，正在上传到图床...");
        try {
          const dataUri = `data:image/png;base64,${img}`;
          const shortUrl = await uploadBase64ToImageBed(dataUri);
          processedImageUrls.push(shortUrl);
          info("Pollinations", `✅ 纯 Base64 图片已转换为短 URL`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          error("Pollinations", `❌ 图片上传失败: ${msg}`);
          throw new Error("图片处理失败：无法上传到图床。请使用较小的图片或直接提供图片 URL。");
        }
      }
    }

    const imageParam = processedImageUrls.join("|");
    const encodedPrompt = encodeURIComponent(prompt || "Edit the image");
    const url = `${PollinationsConfig.apiUrl}${PollinationsConfig.imageEndpoint}/${encodedPrompt}`;

    const params = new URLSearchParams({
      model: actualModel,
      width: String(width),
      height: String(height),
      image: imageParam,
    });

    if (PollinationsConfig.seed !== undefined) params.set("seed", String(PollinationsConfig.seed));
    if (PollinationsConfig.quality !== undefined) {
      params.set("quality", String(PollinationsConfig.quality));
    }
    if (PollinationsConfig.transparent) params.set("transparent", "true");
    if (PollinationsConfig.guidanceScale !== undefined) {
      params.set("guidance_scale", String(PollinationsConfig.guidanceScale));
    }
    if (PollinationsConfig.nologo) params.set("nologo", "true");
    if (PollinationsConfig.enhance) params.set("enhance", "true");
    if (PollinationsConfig.negativePrompt) {
      params.set("negative_prompt", PollinationsConfig.negativePrompt);
    }
    if (PollinationsConfig.private) params.set("private", "true");
    if (PollinationsConfig.nofeed) params.set("nofeed", "true");
    if (PollinationsConfig.safe) params.set("safe", "true");

    const fullUrl = `${url}?${params.toString()}`;

    info("Pollinations", `图生图请求，模型: ${actualModel}, 图片数: ${images.length}`);

    const response = await withApiTiming(
      "Pollinations",
      "image_edit",
      () =>
        fetchWithTimeout(fullUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
          },
        }, API_TIMEOUT_MS),
    );

    if (!response.ok) {
    const errorText = await response.text();
    error("Pollinations", `API 请求失败 (${response.status}): ${errorText.substring(0, 1000)}`);
    const friendlyError = parseErrorMessage(errorText, response.status, "Pollinations");
    throw new Error(friendlyError);
  }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    let mimeType = detectImageMimeType(uint8Array);
    if (!mimeType) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.startsWith("image/")) {
        mimeType = contentType.split(";")[0].trim();
      } else {
        mimeType = "image/png";
      }
    }

    const base64 = encodeBase64(uint8Array);
    return `data:${mimeType};base64,${base64}`;
  }
}

// 导出单例实例
export const pollinationsProvider = new PollinationsProvider();
