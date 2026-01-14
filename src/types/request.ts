/**
 * 请求/响应类型定义
 *
 * 从 main.ts 提取的类型定义，用于统一管理请求和响应格式
 */

/** 文本内容项 */
export interface TextContentItem {
  type: "text";
  text: string;
}

/** 图片 URL 内容项（标准 OpenAI 格式） */
export interface ImageUrlContentItem {
  type: "image_url";
  image_url?: { url: string };
}

/** 非标准图片内容项（如 Cherry Studio 格式） */
export interface NonStandardImageContentItem {
  type: "image";
  image: string; // 纯 Base64 数据（无前缀）
  mediaType?: string; // 例如 "image/png"
}

/** 消息内容项联合类型 */
export type MessageContentItem =
  | TextContentItem
  | ImageUrlContentItem
  | NonStandardImageContentItem;

/** 消息接口 */
export interface Message {
  role: string;
  content: string | MessageContentItem[];
}

/** Chat Completions 请求格式 */
export interface ChatRequest {
  model?: string;
  messages: Message[];
  stream?: boolean;
  size?: string;
  [key: string]: unknown;
}

/** OpenAI Images API 请求格式 */
export interface ImagesRequest {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
  [key: string]: unknown;
}

/** OpenAI Images Edit API 请求格式 */
export interface ImagesEditRequest {
  model?: string;
  prompt: string;
  image: File | Blob | string; // 支持 File、Blob 或 Base64 字符串
  mask?: File | Blob | string; // 可选的遮罩
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
  [key: string]: unknown;
}

/** 图片数据接口 */
export interface ImageData {
  url?: string;
  b64_json?: string;
}

/** Chat Completions 响应格式 */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Chat Completions 流式响应格式 */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

/** Images API 响应格式 */
export interface ImagesResponse {
  created: number;
  data: ImageData[];
}

/** 图片生成请求（Provider 内部使用） */
export interface ImageGenerationRequest {
  /** 提示词 */
  prompt: string;
  /** 输入图片数组（URL 或 Base64） */
  images: string[];
  /** 模型名称 */
  model?: string;
  /** 输出尺寸 */
  size?: string;
  /** 生成数量 */
  n?: number;
  /** 响应格式 */
  response_format?: "url" | "b64_json";
}
