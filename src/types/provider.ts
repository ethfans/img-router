/**
 * Provider 类型定义
 *
 * 定义图片生成服务提供商的核心类型
 *
 * 注意：
 * - Provider 的具体接口 IProvider 定义在 src/providers/base.ts 中
 * - 各Provider 的配置常量定义在 src/config/index.ts 中
 * - 此文件仅包含被其他模块实际使用的共享类型
 */

import type { ImageData } from "./request.ts";

/** 支持的 Provider 类型 */
export type ProviderType =
  | "Doubao"
  | "Gitee"
  | "ModelScope"
  | "HuggingFace"
  | "Pollinations"
  | "Unknown";

/** Provider 生成结果 */
export interface GenerationResult {
  /** 是否成功 */
  success: boolean;
  /** 图片数据数组 */
  images?: ImageData[];
  /** 使用的模型 */
  model?: string;
  /** Provider 名称 */
  provider?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 生成耗时（毫秒，可选） */
  duration?: number;
}
