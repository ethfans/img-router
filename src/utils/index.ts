/**
 * @fileoverview 工具函数统一导出模块
 *
 * 集中导出项目中所有的通用工具函数，方便其他模块通过 `import { ... } from "./utils"` 的方式引用。
 * 包含 HTTP 请求、安全校验、图片处理等核心功能。
 */

// ==========================================
// HTTP 网络请求工具
// ==========================================
export { fetchWithTimeout, get, postFormData, postJson } from "./http.ts";

// ==========================================
// 安全校验与防护工具
// ==========================================
export {
  isPrivateIp,
  isSafeHostname,
  isSafeUrl,
  isValidApiKeyFormat,
  maskSensitive,
  sanitizeInput,
} from "./security.ts";

// ==========================================
// 图片处理与转换工具
// ==========================================
export {
  base64ToUint8Array,
  base64ToUrl,
  buildDataUri,
  calculateBase64Size,
  detectImageFormat,
  extractBase64FromDataUri,
  extractMimeTypeFromDataUri,
  formatFileSize,
  getMimeType,
  isValidBase64,
  normalizeAndCompressInputImages,
  uint8ArrayToBase64,
  urlToBase64,
} from "./image.ts";

// ==========================================
// 类型定义导出
// ==========================================
export type { UrlToBase64Result } from "./image.ts";
