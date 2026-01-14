/**
 * 图片处理工具函数
 *
 * 提供 Base64 编解码、格式转换等图片处理功能
 */

import { ImageBedConfig } from "../config/index.ts";
import { fetchWithTimeout } from "./http.ts";
import { Image } from "imagescript";

/** URL 转 Base64 结果 */
export interface UrlToBase64Result {
  /** Base64 编码的图片数据（不含 data URI 前缀） */
  base64: string;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 将 URL 图片转换为 Base64 字符串
 *
 * @param url - 图片 URL
 * @returns 包含 Base64 数据和 MIME 类型的对象
 */
export async function urlToBase64(url: string): Promise<UrlToBase64Result> {
  const response = await fetchWithTimeout(url, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`获取图片失败: ${response.status} ${response.statusText}`);
  }

  // 获取 MIME 类型
  const contentType = response.headers.get("content-type") || "image/png";
  const mimeType = contentType.split(";")[0].trim();

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 将 Uint8Array 转换为 Base64
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return {
    base64: btoa(binary),
    mimeType,
  };
}

/**
 * 将 Base64 图片上传到图床并返回 URL
 *
 * @param base64 - Base64 编码的图片数据
 * @param mimeType - MIME 类型，默认 "image/png"
 * @returns 图片 URL
 */
export async function base64ToUrl(base64: string, mimeType: string = "image/png"): Promise<string> {
  let base64Content = base64;
  let resolvedMimeType = mimeType;

  if (base64.startsWith("data:image/")) {
    const parts = base64.split(",");
    if (parts.length < 2) throw new Error("Base64 Data URI 格式异常");
    base64Content = parts[1];
    resolvedMimeType = parts[0].split(";")[0].split(":")[1] || mimeType;
  } else {
    base64Content = base64.replace(/^data:[^;]+;base64,/, "");
  }

  const binaryData = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));
  const blob = new Blob([binaryData], { type: resolvedMimeType });

  const extMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  const ext = extMap[resolvedMimeType] || "png";
  const filename = `img_${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append("file", blob, filename);

  const uploadUrl = new URL(ImageBedConfig.uploadEndpoint, ImageBedConfig.baseUrl);
  uploadUrl.searchParams.set("uploadChannel", ImageBedConfig.uploadChannel);
  uploadUrl.searchParams.set("uploadFolder", ImageBedConfig.uploadFolder);
  uploadUrl.searchParams.set("returnFormat", "full");

  if (!ImageBedConfig.authCode) {
    throw new Error("图床鉴权未配置：请设置 IMAGE_BED_AUTH_CODE");
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${ImageBedConfig.authCode}`,
  };

  const response = await fetchWithTimeout(
    uploadUrl.toString(),
    {
      method: "POST",
      headers,
      body: formData,
    },
    60000,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`图床上传失败: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();

  // 兼容两种响应格式：
  // 1. 标准格式: { code: 200, data: { url: "..." } }
  // 2. 数组格式: [{ src: "..." }] (当前图床实际返回格式)
  let imageUrl: string | undefined;

  if (Array.isArray(result) && result.length > 0 && result[0].src) {
    imageUrl = result[0].src;
  } else if (result.code === 200 && result.data?.url) {
    imageUrl = result.data.url;
  }

  if (!imageUrl) {
    throw new Error(`图床响应异常: ${JSON.stringify(result)}`);
  }

  // 补全 URL
  if (!imageUrl.startsWith("http")) {
    imageUrl = `${ImageBedConfig.baseUrl}${imageUrl}`;
  }

  // info("ImageBed", `✅ 图片上传成功: ${imageUrl}`); // 这里如果需要可以加日志，但调用方已经加了
  return imageUrl;
}

/**
 * 将 Base64 字符串转换为 Uint8Array
 *
 * @param base64 - Base64 编码的数据
 * @returns Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // 移除可能存在的 data URI 前缀
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");

  const binary = atob(cleanBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * 将 Uint8Array 转换为 Base64 字符串
 *
 * @param uint8Array - Uint8Array 数据
 * @returns Base64 编码的字符串
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * 检测图片格式
 *
 * @param data - 图片数据（Uint8Array 或 Base64 字符串）
 * @returns 图片格式（"png" | "jpeg" | "webp" | "gif" | "unknown"）
 */
export function detectImageFormat(data: Uint8Array | string): string {
  let bytes: Uint8Array;

  if (typeof data === "string") {
    bytes = base64ToUint8Array(data);
  } else {
    bytes = data;
  }

  // 检查文件头魔数
  if (bytes.length < 4) {
    return "unknown";
  }

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return "jpeg";
  }

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (
      bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "webp";
    }
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif";
  }

  return "unknown";
}

/**
 * 获取图片的 MIME 类型
 *
 * @param format - 图片格式
 * @returns MIME 类型
 */
export function getMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };

  return mimeTypes[format.toLowerCase()] || "application/octet-stream";
}

/**
 * 构建 Data URI
 *
 * @param base64 - Base64 编码的数据
 * @param mimeType - MIME 类型
 * @returns Data URI 字符串
 */
export function buildDataUri(base64: string, mimeType: string): string {
  // 移除可能存在的 data URI 前缀
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
  return `data:${mimeType};base64,${cleanBase64}`;
}

/**
 * 从 Data URI 中提取 Base64 数据
 *
 * @param dataUri - Data URI 字符串
 * @returns Base64 编码的数据
 */
export function extractBase64FromDataUri(dataUri: string): string {
  const match = dataUri.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : dataUri;
}

/**
 * 从 Data URI 中提取 MIME 类型
 *
 * @param dataUri - Data URI 字符串
 * @returns MIME 类型，如果无法提取则返回 null
 */
export function extractMimeTypeFromDataUri(dataUri: string): string | null {
  const match = dataUri.match(/^data:([^;]+);base64,/);
  return match ? match[1] : null;
}

/**
 * 验证 Base64 字符串是否有效
 *
 * @param base64 - Base64 字符串
 * @returns 是否有效
 */
export function isValidBase64(base64: string): boolean {
  // 移除可能存在的 data URI 前缀
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");

  // 检查是否只包含有效的 Base64 字符
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

  if (!base64Regex.test(cleanBase64)) {
    return false;
  }

  // 尝试解码
  try {
    atob(cleanBase64);
    return true;
  } catch {
    return false;
  }
}

/**
 * 计算图片数据大小（字节）
 *
 * @param base64 - Base64 编码的数据
 * @returns 原始数据大小（字节）
 */
export function calculateBase64Size(base64: string): number {
  // 移除可能存在的 data URI 前缀
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");

  // Base64 编码后的大小约为原始大小的 4/3
  // 需要考虑填充字符
  const padding = (cleanBase64.match(/=/g) || []).length;
  return Math.floor((cleanBase64.length * 3) / 4) - padding;
}

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串（如 "1.5 MB"）
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

async function tryGetContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" }, 8000);
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    if (!len) return null;
    const n = Number(len);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function compressDataUriToTarget(dataUri: string, targetBytes: number): Promise<string> {
  const mimeType = extractMimeTypeFromDataUri(dataUri) || "image/png";
  if (mimeType === "image/gif") return dataUri;

  const rawBytes = base64ToUint8Array(dataUri);
  if (rawBytes.byteLength <= targetBytes) return dataUri;

  let image: Image;
  try {
    image = await Image.decode(rawBytes);
  } catch {
    return dataUri;
  }

  const qualities = [85, 75, 65, 55, 45, 35, 25];
  let best: Uint8Array | null = null;

  const working = image;
  for (let pass = 0; pass < 6; pass++) {
    for (const q of qualities) {
      let encoded: Uint8Array;
      try {
        encoded = await working.encodeJPEG(q);
      } catch {
        return dataUri;
      }

      if (!best || encoded.byteLength < best.byteLength) best = encoded;
      if (encoded.byteLength <= targetBytes) {
        return buildDataUri(uint8ArrayToBase64(encoded), "image/jpeg");
      }
    }

    const newWidth = Math.max(1, Math.floor(working.width * 0.85));
    if (newWidth >= working.width) break;
    try {
      working.resize(newWidth, Image.RESIZE_AUTO);
    } catch {
      break;
    }
  }

  if (best) return buildDataUri(uint8ArrayToBase64(best), "image/jpeg");
  return dataUri;
}

export async function normalizeAndCompressInputImages(
  images: string[],
  options?: { maxBytes?: number; targetBytes?: number },
): Promise<string[]> {
  const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;
  const targetBytes = options?.targetBytes ?? 1024 * 1024;

  const results: string[] = [];
  for (const img of images) {
    if (!img) continue;

    if (img.startsWith("http")) {
      const contentLength = await tryGetContentLength(img);
      if (contentLength !== null && contentLength <= maxBytes) {
        results.push(img);
        continue;
      }

      try {
        const downloaded = await urlToBase64(img);
        const dataUri = buildDataUri(downloaded.base64, downloaded.mimeType);
        const sizeBytes = calculateBase64Size(dataUri);
        if (sizeBytes <= maxBytes) {
          results.push(img);
          continue;
        }
        results.push(await compressDataUriToTarget(dataUri, targetBytes));
        continue;
      } catch {
        results.push(img);
        continue;
      }
    }

    const sizeBytes = calculateBase64Size(img);
    if (sizeBytes <= maxBytes) {
      results.push(img);
      continue;
    }

    const dataUri = img.startsWith("data:") ? img : buildDataUri(img, "image/png");
    results.push(await compressDataUriToTarget(dataUri, targetBytes));
  }
  return results;
}
