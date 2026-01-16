/**
 * @fileoverview 安全工具模块
 * 
 * 提供系统安全相关的工具函数，主要包括：
 * 1. SSRF (服务端请求伪造) 防护：检查 IP 和 URL 安全性
 * 2. 输入清洗：防止注入攻击
 * 3. 敏感信息脱敏：用于日志记录时的密钥隐藏
 */

/**
 * 私有 IP 地址范围正则列表
 * 用于识别内网 IP，防止 SSRF 攻击访问内部服务
 */
const PRIVATE_IP_RANGES = [
  /^127\./, // 127.0.0.0/8 - 本地回环地址
  /^10\./, // 10.0.0.0/8 - A 类私有网络
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 - B 类私有网络
  /^192\.168\./, // 192.168.0.0/16 - C 类私有网络
  /^169\.254\./, // 169.254.0.0/16 - 链路本地地址
  /^0\./, // 0.0.0.0/8 - 当前网络
  /^224\./, // 224.0.0.0/4 - 多播地址
  /^240\./, // 240.0.0.0/4 - 保留地址
];

/**
 * 危险的主机名列表
 * 包含本地主机和常见的云服务元数据地址
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
 * 检查 IP 地址是否为私有地址或保留地址
 * 
 * @param {string} ip - 待检查的 IP 地址字符串
 * @returns {boolean} 如果是私有 IP 则返回 true
 */
export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

/**
 * 检查主机名是否安全
 * 验证主机名是否在危险列表中，或是否解析为私有 IP
 * 
 * @param {string} hostname - 待检查的主机名
 * @returns {boolean} 如果主机名安全则返回 true
 */
export function isSafeHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // 检查是否为危险主机名
  if (DANGEROUS_HOSTNAMES.includes(lowerHostname)) {
    return false;
  }

  // 检查是否为私有 IP (简单正则匹配，不进行 DNS 解析以避免 Rebinding 攻击)
  if (isPrivateIp(hostname)) {
    return false;
  }

  return true;
}

/**
 * 检查 URL 是否安全
 * 用于防止 SSRF 攻击，确保请求不会发往内网或敏感服务
 * 
 * @param {string} urlString - 待检查的完整 URL
 * @returns {boolean} 如果 URL 安全则返回 true
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // 只允许 http 和 https 协议，禁止 file://, gopher:// 等危险协议
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
 * 清理用户输入的字符串
 * 移除潜在的危险字符，防止注入攻击
 * 
 * @param {string} input - 用户原始输入
 * @param {number} [maxLength=10000] - 允许的最大长度
 * @returns {string} 清理后的安全字符串
 */
export function sanitizeInput(input: string, maxLength: number = 10000): string {
  if (typeof input !== "string") {
    return "";
  }

  // 截断过长的输入
  const truncated = input.slice(0, maxLength);

  // 移除控制字符（保留换行符 0x0A 和制表符 0x09）
  // 控制字符可能破坏日志格式或用于终端注入攻击
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
 * 验证 API 密钥格式是否有效
 * 仅检查格式（长度和字符集），不验证密钥的真实性
 * 
 * @param {string} apiKey - 待验证的 API 密钥
 * @param {number} [minLength=10] - 最小允许长度
 * @returns {boolean} 格式有效返回 true
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
  // 这是一个通用的 API Key 格式假设
  if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) {
    return false;
  }

  return true;
}

/**
 * 对敏感信息（如 API Key）进行脱敏处理
 * 用于在日志或界面中安全地显示部分信息
 * 
 * @param {string} value - 原始敏感值
 * @param {number} [visibleChars=4] - 开头和结尾保留的可见字符数
 * @returns {string} 脱敏后的字符串 (如 "sk-a****bcde")
 */
export function maskSensitive(value: string, visibleChars: number = 4): string {
  if (typeof value !== "string" || value.length <= visibleChars * 2) {
    return "****";
  }

  const start = value.slice(0, visibleChars);
  const end = value.slice(-visibleChars);
  return `${start}****${end}`;
}
