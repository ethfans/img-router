/**
 * 安全工具函数
 *
 * 提供 URL 安全校验、SSRF 防护等安全相关功能
 */

/**
 * 私有 IP 地址范围（用于 SSRF 防护）
 */
const PRIVATE_IP_RANGES = [
  /^127\./, // 127.0.0.0/8 - 本地回环
  /^10\./, // 10.0.0.0/8 - A 类私有
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 - B 类私有
  /^192\.168\./, // 192.168.0.0/16 - C 类私有
  /^169\.254\./, // 169.254.0.0/16 - 链路本地
  /^0\./, // 0.0.0.0/8 - 当前网络
  /^224\./, // 224.0.0.0/4 - 多播地址
  /^240\./, // 240.0.0.0/4 - 保留地址
];

/**
 * 危险的主机名（用于 SSRF 防护）
 */
const DANGEROUS_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal", // GCP 元数据服务
  "169.254.169.254", // AWS/Azure/GCP 元数据服务
];

/**
 * 检查 IP 地址是否为私有地址
 *
 * @param ip - IP 地址字符串
 * @returns 是否为私有地址
 */
export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

/**
 * 检查主机名是否安全（非私有/危险地址）
 *
 * @param hostname - 主机名
 * @returns 是否安全
 */
export function isSafeHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // 检查是否为危险主机名
  if (DANGEROUS_HOSTNAMES.includes(lowerHostname)) {
    return false;
  }

  // 检查是否为私有 IP
  if (isPrivateIp(hostname)) {
    return false;
  }

  return true;
}

/**
 * 检查 URL 是否安全（用于 SSRF 防护）
 *
 * @param urlString - URL 字符串
 * @returns 是否安全
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // 只允许 http 和 https 协议
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    // 检查主机名是否安全
    if (!isSafeHostname(url.hostname)) {
      return false;
    }

    return true;
  } catch {
    // URL 解析失败，视为不安全
    return false;
  }
}

/**
 * 清理用户输入的字符串（防止注入攻击）
 *
 * @param input - 用户输入
 * @param maxLength - 最大长度，默认 10000
 * @returns 清理后的字符串
 */
export function sanitizeInput(input: string, maxLength: number = 10000): string {
  if (typeof input !== "string") {
    return "";
  }

  // 截断过长的输入
  const truncated = input.slice(0, maxLength);

  // 移除控制字符（保留换行符 0x0A 和制表符 0x09）
  let result = "";
  for (const char of truncated) {
    const code = char.charCodeAt(0);
    // 跳过控制字符：0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F
    if (
      (code >= 0x00 && code <= 0x08) || code === 0x0B || code === 0x0C ||
      (code >= 0x0E && code <= 0x1F) || code === 0x7F
    ) {
      continue;
    }
    result += char;
  }

  return result;
}

/**
 * 验证 API 密钥格式
 *
 * @param apiKey - API 密钥
 * @param minLength - 最小长度，默认 10
 * @returns 是否为有效格式
 */
export function isValidApiKeyFormat(apiKey: string, minLength: number = 10): boolean {
  if (typeof apiKey !== "string") {
    return false;
  }

  // 检查长度
  if (apiKey.length < minLength) {
    return false;
  }

  // 检查是否只包含允许的字符（字母、数字、下划线、连字符）
  if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) {
    return false;
  }

  return true;
}

/**
 * 掩码敏感信息（用于日志输出）
 *
 * @param value - 敏感值
 * @param visibleChars - 可见字符数，默认 4
 * @returns 掩码后的字符串
 */
export function maskSensitive(value: string, visibleChars: number = 4): string {
  if (typeof value !== "string" || value.length <= visibleChars) {
    return "****";
  }

  const visible = value.slice(0, visibleChars);
  const masked = "*".repeat(Math.min(value.length - visibleChars, 20));

  return `${visible}${masked}`;
}
