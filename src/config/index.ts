/**
 * 应用配置模块
 *
 * 集中管理所有配置项，从环境变量读取敏感信息
 */

// ============================================================================
// 服务器配置
// ============================================================================

/**
 * 服务器监听端口
 */
export const PORT = parseInt(Deno.env.get("PORT") || "8787", 10);

/**
 * API 请求超时时间（毫秒）
 */
export const API_TIMEOUT_MS = parseInt(
  Deno.env.get("API_TIMEOUT_MS") || "300000",
  10,
);

/**
 * 最大请求体大小（字节）
 */
export const MAX_REQUEST_BODY_SIZE = parseInt(
  Deno.env.get("MAX_REQUEST_BODY_SIZE") || "10485760", // 10MB
  10,
);

// ============================================================================
// Provider API 密钥配置
// ============================================================================

/**
 * 火山引擎 API 密钥
 */
export const VOLC_ACCESS_KEY = Deno.env.get("VOLC_ACCESS_KEY") || "";
export const VOLC_SECRET_KEY = Deno.env.get("VOLC_SECRET_KEY") || "";

/**
 * Gitee AI API 密钥
 */
export const GITEE_AI_API_KEY = Deno.env.get("GITEE_AI_API_KEY") || "";

/**
 * ModelScope API 密钥
 */
export const MODELSCOPE_API_KEY = Deno.env.get("MODELSCOPE_API_KEY") || "";

/**
 * HuggingFace API 密钥
 */
export const HUGGINGFACE_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY") || "";

// ============================================================================
// 模型配置
// ============================================================================

/**
 * 默认图片生成模型
 */
export const DEFAULT_IMAGE_MODEL = "doubao-seedream-4-5-251128";

/**
 * 默认图片尺寸
 */
export const DEFAULT_IMAGE_SIZE = "1024x1024";

/**
 * 默认图片质量
 */
export const DEFAULT_IMAGE_QUALITY = "standard";

/**
 * 默认图片数量
 */
export const DEFAULT_IMAGE_COUNT = 1;

// ============================================================================
// Provider 配置
// ============================================================================

/**
 * 火山引擎（豆包）配置
 */
export const DoubaoConfig = {
  apiUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  defaultModel: "doubao-seedream-4-5-251128",
  defaultSize: "2K",
  defaultEditSize: "2K",
  supportedModels: [
    "doubao-seedream-4-5-251128",
    "doubao-seedream-4-0-250828",
  ],
};

/**
 * Gitee（模力方舟）配置
 */
export const GiteeConfig = {
  apiUrl: "https://ai.gitee.com/v1/images/generations",
  editApiUrl: "https://ai.gitee.com/v1/images/edits",
  asyncEditApiUrl: "https://ai.gitee.com/v1/async/images/edits",
  taskStatusUrl: "https://ai.gitee.com/v1/task",
  defaultModel: "z-image-turbo",
  defaultEditModel: "Qwen-Image-Edit",
  defaultAsyncEditModel: "Qwen-Image-Edit-2511",
  defaultSize: "2048x2048",
  defaultEditSize: "1024x1024",
  defaultAsyncEditSize: "2048x2048",
  supportedModels: ["z-image-turbo"],
  editModels: [
    "Qwen-Image-Edit",
    "HiDream-E1-Full",
    "FLUX.1-dev",
    "FLUX.2-dev",
    "FLUX.1-Kontext-dev",
    "HelloMeme",
    "Kolors",
    "OmniConsistency",
    "InstantCharacter",
    "DreamO",
    "LongCat-Image-Edit",
    "AnimeSharp",
  ],
  asyncEditModels: [
    "Qwen-Image-Edit-2511",
    "LongCat-Image-Edit",
    "FLUX.1-Kontext-dev",
  ],
};

/**
 * ModelScope（魔搭）配置
 */
export const ModelScopeConfig = {
  apiUrl: "https://api-inference.modelscope.cn/v1",
  defaultModel: "Tongyi-MAI/Z-Image-Turbo",
  defaultEditModel: "Qwen/Qwen-Image-Edit",
  defaultSize: "1024x1024",
  defaultEditSize: "1024x1024",
  supportedModels: ["Tongyi-MAI/Z-Image-Turbo"],
  editModels: [
    "Qwen/Qwen-Image-Edit-2511",
    "Qwen/Qwen-Image-Edit-2509",
    "Qwen/Qwen-Image-Edit"
  ],
};

/**
 * HuggingFace 配置
 */
export const HuggingFaceConfig = {
  apiUrls: [
    "https://mrfakename-z-image-turbo.hf.space",
    "https://luca115-z-image-turbo.hf.space",
    "https://linoyts-z-image-portrait.hf.space",
    "https://prokofyev8-z-image-portrait.hf.space",
    "https://yingzhac-z-image-nsfw.hf.space",
  ],
  editApiUrls: ["https://lenml-qwen-image-edit-2511-fast.hf.space"],
  defaultModel: "z-image-turbo",
  defaultEditModel: "Qwen-Image-Edit-2511",
  defaultSize: "1024x1024",
  defaultEditSize: "1024x1024",
  supportedModels: ["z-image-turbo"],
  editModels: ["Qwen-Image-Edit-2511"],
};

/**
 * Pollinations 配置
 */
export const PollinationsConfig = {
  apiUrl: "https://gen.pollinations.ai",
  imageEndpoint: "/image",
  defaultModel: "flux",
  defaultEditModel: "nanobanana-pro",
  defaultSize: "1024x1024",
  defaultEditSize: "1024x1024",
  supportedModels: [
    "flux",
    "turbo",
    "zimage",
    "kontext",
    "nanobanana",
    "nanobanana-pro",
    "seedream",
    "seedream-pro",
    "gptimage",
    "gptimage-large",
    "veo",
    "seedance",
    "seedance-pro",
  ],
  editModels: [
    "nanobanana-pro",
    "gptimage",
    "gptimage-large",
    "nanobanana",
    "seedream",
    "seedream-pro",
  ],
  seed: -1,
  quality: "hd" as const,
  transparent: false,
  guidanceScale: undefined,
  enhance: true,
  negativePrompt: "",
  private: true,
  nologo: true,
  nofeed: false,
  safe: false,
};

/**
 * 图床配置
 */
export const ImageBedConfig = {
  baseUrl: Deno.env.get("IMAGE_BED_BASE_URL") || "https://imgbed.lianwusuoai.top",
  uploadEndpoint: "/upload",
  authCode: Deno.env.get("IMAGE_BED_AUTH_CODE") || "imgbed_xKAGfobLGhsEBEMlt5z0yvYdtw8zNTM6",
  uploadFolder: Deno.env.get("IMAGE_BED_UPLOAD_FOLDER") || "img-router",
  uploadChannel: Deno.env.get("IMAGE_BED_UPLOAD_CHANNEL") || "s3",
};

// ============================================================================
// 支持的模型列表
// ============================================================================

/**
 * 火山引擎支持的模型
 */
export const DOUBAO_MODELS = DoubaoConfig.supportedModels;

/**
 * Gitee AI 支持的模型
 */
export const GITEE_MODELS = [
  ...new Set([
    ...GiteeConfig.supportedModels,
    ...GiteeConfig.editModels,
    ...GiteeConfig.asyncEditModels,
  ]),
];

/**
 * ModelScope 支持的模型
 */
export const MODELSCOPE_MODELS = [
  ...new Set([
    ...ModelScopeConfig.supportedModels,
    ...ModelScopeConfig.editModels,
  ]),
];

/**
 * HuggingFace 支持的模型
 */
export const HUGGINGFACE_MODELS = [
  ...new Set([
    ...HuggingFaceConfig.supportedModels,
    ...HuggingFaceConfig.editModels,
  ]),
];

/**
 * Pollinations 支持的模型
 */
export const POLLINATIONS_MODELS = [
  ...new Set([
    ...PollinationsConfig.supportedModels,
    ...PollinationsConfig.editModels,
  ]),
];

/**
 * 所有支持的模型列表
 */
export const ALL_SUPPORTED_MODELS = [
  ...new Set([
    ...DOUBAO_MODELS,
    ...GITEE_MODELS,
    ...MODELSCOPE_MODELS,
    ...HUGGINGFACE_MODELS,
    ...POLLINATIONS_MODELS,
  ]),
];

// ============================================================================
// 尺寸配置
// ============================================================================

/**
 * 支持的图片尺寸
 */
export const SUPPORTED_SIZES = [
  "256x256",
  "512x512",
  "768x768",
  "1024x1024",
  "1024x576",
  "576x1024",
  "1024x768",
  "768x1024",
  "1280x720",
  "720x1280",
  "1536x1024",
  "1024x1536",
];

/**
 * 尺寸映射（OpenAI 格式到实际尺寸）
 */
export const SIZE_MAPPING: Record<string, { width: number; height: number }> = {
  "256x256": { width: 256, height: 256 },
  "512x512": { width: 512, height: 512 },
  "768x768": { width: 768, height: 768 },
  "1024x1024": { width: 1024, height: 1024 },
  "1024x576": { width: 1024, height: 576 },
  "576x1024": { width: 576, height: 1024 },
  "1024x768": { width: 1024, height: 768 },
  "768x1024": { width: 768, height: 1024 },
  "1280x720": { width: 1280, height: 720 },
  "720x1280": { width: 720, height: 1280 },
  "1536x1024": { width: 1536, height: 1024 },
  "1024x1536": { width: 1024, height: 1536 },
};

// ============================================================================
// 日志配置
// ============================================================================

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 当前日志级别
 */
export const LOG_LEVEL: LogLevel = (Deno.env.get("LOG_LEVEL") || "info") as LogLevel;

/**
 * 是否启用详细日志
 */
export const VERBOSE_LOGGING = Deno.env.get("VERBOSE_LOGGING") === "true";

// ============================================================================
// 功能开关
// ============================================================================

/**
 * 是否启用 CORS
 */
export const ENABLE_CORS = Deno.env.get("ENABLE_CORS") !== "false";

/**
 * 是否启用请求日志
 */
export const ENABLE_REQUEST_LOGGING = Deno.env.get("ENABLE_REQUEST_LOGGING") !== "false";

/**
 * 是否启用健康检查端点
 */
export const ENABLE_HEALTH_CHECK = Deno.env.get("ENABLE_HEALTH_CHECK") !== "false";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查是否配置了指定的 Provider
 *
 * @param provider - Provider 名称
 * @returns 是否已配置
 */
export function isProviderConfigured(provider: string): boolean {
  switch (provider.toLowerCase()) {
    case "doubao":
      return !!(VOLC_ACCESS_KEY && VOLC_SECRET_KEY);
    case "gitee":
      return !!GITEE_AI_API_KEY;
    case "modelscope":
      return !!MODELSCOPE_API_KEY;
    case "huggingface":
      return !!HUGGINGFACE_API_KEY;
    case "pollinations":
      return true; // Pollinations 不需要 API 密钥
    default:
      return false;
  }
}

/**
 * 获取模型对应的 Provider
 *
 * @param model - 模型名称
 * @returns Provider 名称，如果未找到返回 null
 */
export function getProviderForModel(model: string): string | null {
  if (DOUBAO_MODELS.includes(model)) return "doubao";
  if (GITEE_MODELS.includes(model)) return "gitee";
  if (MODELSCOPE_MODELS.includes(model)) return "modelscope";
  if (HUGGINGFACE_MODELS.includes(model)) return "huggingface";
  if (POLLINATIONS_MODELS.includes(model)) return "pollinations";
  return null;
}

/**
 * 解析尺寸字符串
 *
 * @param size - 尺寸字符串，如 "1024x1024"
 * @returns 宽高对象，如果解析失败返回默认值
 */
export function parseSize(size: string): { width: number; height: number } {
  const mapping = SIZE_MAPPING[size];
  if (mapping) return mapping;

  // 尝试解析自定义尺寸
  const match = size.match(/^(\d+)x(\d+)$/);
  if (match) {
    return {
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    };
  }

  // 返回默认尺寸
  return { width: 1024, height: 1024 };
}
