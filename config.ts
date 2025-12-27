// ================= 渠道配置 =================
// 支持：火山引擎 (VolcEngine/豆包)、Gitee (模力方舟)、ModelScope (魔塔)、Hugging Face

// 渠道配置接口
export interface ProviderConfig {
  apiUrl: string;
  defaultModel: string;
  supportedModels: string[];
}

// Hugging Face 多 URL 配置接口（支持故障转移）
export interface HuggingFaceProviderConfig {
  apiUrls: string[];  // URL 资源池，按优先级排序
  defaultModel: string;
  supportedModels: string[];
}

// 火山引擎（豆包）配置
export const VolcEngineConfig: ProviderConfig = {
  apiUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  defaultModel: "doubao-seedream-4-0-250828",
  supportedModels: [
    "doubao-seedream-4-0-250828",
    "doubao-seedream-4-5-251128",
  ],
};

// Gitee（模力方舟）配置
export const GiteeConfig: ProviderConfig = {
  apiUrl: "https://ai.gitee.com/v1/images/generations",
  defaultModel: "z-image-turbo",
  supportedModels: [
    "z-image-turbo",
  ],
};

// ModelScope（魔塔）配置
export const ModelScopeConfig: ProviderConfig = {
  apiUrl: "https://api-inference.modelscope.cn/v1",
  defaultModel: "Tongyi-MAI/Z-Image-Turbo",
  supportedModels: [
    "Tongyi-MAI/Z-Image-Turbo",
  ],
};

// Hugging Face 配置 (使用 HF Spaces Gradio API，支持多 URL 故障转移)
export const HuggingFaceConfig: HuggingFaceProviderConfig = {
  // URL 资源池：当一个失败时自动切换到下一个
  apiUrls: [
    "https://luca115-z-image-turbo.hf.space",
    "https://mcp-tools-z-image-turbo.hf.space",
    "https://cpuai-z-image-turbo.hf.space",
    "https://victor-z-image-turbo-mcp.hf.space",
    "https://wavespeed-z-image-turbo.hf.space",
    "https://jinguotianxin-z-image-turbo.hf.space",
    "https://prithivmlmods-z-image-turbo-lora-dlc.hf.space",
    "https://linoyts-z-image-portrait.hf.space",
    "https://prokofyev8-z-image-portrait.hf.space",
    "https://ovi054-z-image-lora.hf.space",
    "https://yingzhac-z-image-nsfw.hf.space",
    "https://nymbo-tools.hf.space",
  ],
  defaultModel: "z-image-turbo",
  supportedModels: [
    "z-image-turbo",
  ],
};

// 统一超时时间：300秒（适用于所有渠道的 API 请求，给生图留足时间）
export const API_TIMEOUT_MS = 300000;

// 服务端口
export const PORT = parseInt(Deno.env.get("PORT") || "10001");
