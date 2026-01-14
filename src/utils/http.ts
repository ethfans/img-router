/**
 * HTTP 工具函数
 *
 * 提供带超时控制的 fetch 函数和相关网络请求工具
 */

import { API_TIMEOUT_MS } from "../config/index.ts";
import { isSafeUrl } from "./security.ts";

/**
 * 带超时控制的 fetch 函数
 *
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @param timeoutMs - 超时时间（毫秒），默认使用配置中的 API_TIMEOUT_MS
 * @returns Promise<Response>
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<Response> {
  // 仅对非官方 API 渠道的外部 URL 进行安全校验
  const isOfficialApi = url.includes("volces.com") ||
    url.includes("gitee.com") ||
    url.includes("modelscope.cn") ||
    url.includes("hf.space") ||
    url.includes("pollinations.ai");

  if (url.startsWith("http") && !isOfficialApi) {
    if (!isSafeUrl(url)) {
      throw new Error(`安全限制：禁止访问该 URL (${url})`);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 发送 JSON POST 请求
 *
 * @param url - 请求 URL
 * @param body - 请求体
 * @param headers - 额外的请求头
 * @param timeoutMs - 超时时间
 * @returns Promise<Response>
 */
export function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<Response> {
  return fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }, timeoutMs);
}

/**
 * 发送 GET 请求
 *
 * @param url - 请求 URL
 * @param headers - 额外的请求头
 * @param timeoutMs - 超时时间
 * @returns Promise<Response>
 */
export function get(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<Response> {
  return fetchWithTimeout(url, {
    method: "GET",
    headers,
  }, timeoutMs);
}

/**
 * 发送 FormData POST 请求
 *
 * @param url - 请求 URL
 * @param formData - FormData 对象
 * @param headers - 额外的请求头
 * @param timeoutMs - 超时时间
 * @returns Promise<Response>
 */
export function postFormData(
  url: string,
  formData: FormData,
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<Response> {
  return fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: formData,
  }, timeoutMs);
}
