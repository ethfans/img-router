/**
 * @fileoverview HTTP 网络请求工具模块
 *
 * 提供增强版的 fetch 函数，集成了以下功能：
 * 1. 超时控制 (AbortSignal)
 * 2. SSRF 安全检查 (针对非官方域名)
 * 3. 简化的 POST/GET 封装方法
 * 4. JSON 和 FormData 的便捷处理
 */

import { API_TIMEOUT_MS } from "../config/manager.ts";
import { isSafeUrl } from "./security.ts";

/**
 * 带超时控制和安全检查的 fetch 函数
 *
 * @param {string} url - 请求的目标 URL
 * @param {RequestInit} options - 标准 fetch 选项
 * @param {number} [timeoutMs=API_TIMEOUT_MS] - 超时时间（毫秒），默认为全局配置值
 * @returns {Promise<Response>} Fetch 响应对象
 * @throws {Error} 如果 URL 不安全或请求超时
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<Response> {
  // 仅对非官方 API 渠道的外部 URL 进行安全校验，防止 SSRF 攻击
  // 官方域名通常是可信的，且可能解析为内部 IP（如云服务内网 endpoint）
  const isOfficialApi = url.includes("volces.com") ||
    url.includes("gitee.com") ||
    url.includes("modelscope.cn") ||
    url.includes("hf.space") ||
    url.includes("pollinations.ai");

  if (url.startsWith("http") && !isOfficialApi) {
    if (!isSafeUrl(url)) {
      throw new Error(`安全限制：禁止访问该 URL (${url}) - 潜在的 SSRF 风险`);
    }
  }

  // 创建 AbortController 用于超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    // 无论请求成功与否，都要清除定时器，防止内存泄漏
    clearTimeout(timeoutId);
  }
}

/**
 * 发送 JSON 格式的 POST 请求
 *
 * @param {string} url - 请求 URL
 * @param {unknown} body - 请求体数据（将自动序列化为 JSON）
 * @param {Record<string, string>} [headers={}] - 额外的请求头
 * @param {number} [timeoutMs] - 自定义超时时间
 * @returns {Promise<Response>} 响应对象
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
 * @param {string} url - 请求 URL
 * @param {Record<string, string>} [headers={}] - 额外的请求头
 * @param {number} [timeoutMs] - 自定义超时时间
 * @returns {Promise<Response>} 响应对象
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
 * 发送 FormData 格式的 POST 请求
 * 通常用于文件上传
 *
 * @param {string} url - 请求 URL
 * @param {FormData} formData - FormData 对象
 * @param {Record<string, string>} [headers={}] - 额外的请求头（注意：不要手动设置 Content-Type，浏览器/运行时会自动设置 boundary）
 * @param {number} [timeoutMs] - 自定义超时时间
 * @returns {Promise<Response>} 响应对象
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
