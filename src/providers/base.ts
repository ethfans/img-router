/**
 * Provider 基础接口定义
 *
 * 定义所有图片生成 Provider 必须实现的接口
 */

import type { GenerationResult, ImageGenerationRequest } from "../types/index.ts";

/**
 * Provider 名称类型
 */
export type ProviderName =
  | "Doubao"
  | "Gitee"
  | "ModelScope"
  | "HuggingFace"
  | "Pollinations"
  | "Unknown";

/**
 * Provider 能力描述
 */
export interface ProviderCapabilities {
  /** 是否支持文生图 */
  textToImage: boolean;
  /** 是否支持图生图/图片编辑 */
  imageToImage: boolean;
  /** 是否支持多图融合 */
  multiImageFusion: boolean;
  /** 是否支持异步任务 */
  asyncTask: boolean;
  /** 最大支持的输入图片数量 */
  maxInputImages: number;
  /** 支持的输出格式 */
  outputFormats: ("url" | "b64_json")[];
}

/**
 * Provider 配置接口
 */
export interface ProviderConfig {
  /** API 基础 URL */
  apiUrl: string;
  /** 支持的模型列表 */
  supportedModels: string[];
  /** 默认模型 */
  defaultModel: string;
  /** 默认尺寸 */
  defaultSize: string;
  /** 图片编辑支持的模型（可选） */
  editModels?: string[];
  /** 默认图片编辑模型（可选） */
  defaultEditModel?: string;
  /** 默认图片编辑尺寸（可选） */
  defaultEditSize?: string;
}

/**
 * Provider 生成选项
 */
export interface GenerationOptions {
  /** 请求 ID（用于日志追踪） */
  requestId: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 是否返回 Base64 格式 */
  returnBase64?: boolean;
}

/**
 * Provider 基础接口
 *
 * 所有图片生成 Provider 必须实现此接口
 */
export interface IProvider {
  /** Provider 名称 */
  readonly name: ProviderName;

  /** Provider 能力 */
  readonly capabilities: ProviderCapabilities;

  /** Provider 配置 */
  readonly config: ProviderConfig;

  /**
   * 检测 API Key 是否属于此 Provider
   *
   * @param apiKey - API 密钥
   * @returns 是否匹配
   */
  detectApiKey(apiKey: string): boolean;

  /**
   * 生成图片
   *
   * @param apiKey - API 密钥
   * @param request - 图片生成请求
   * @param options - 生成选项
   * @returns 生成结果
   */
  generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult>;

  /**
   * 获取支持的模型列表
   *
   * @returns 模型列表
   */
  getSupportedModels(): string[];

  /**
   * 验证请求参数
   *
   * @param request - 图片生成请求
   * @returns 验证结果，如果有错误返回错误信息
   */
  validateRequest(request: ImageGenerationRequest): string | null;
}

/**
 * Provider 基类
 *
 * 提供通用实现，子类可以覆盖特定方法
 */
export abstract class BaseProvider implements IProvider {
  abstract readonly name: ProviderName;
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly config: ProviderConfig;

  /**
   * 检测 API Key 是否属于此 Provider
   * 子类必须实现此方法
   */
  abstract detectApiKey(apiKey: string): boolean;

  /**
   * 生成图片
   * 子类必须实现此方法
   */
  abstract generate(
    apiKey: string,
    request: ImageGenerationRequest,
    options: GenerationOptions,
  ): Promise<GenerationResult>;

  /**
   * 获取支持的模型列表
   */
  getSupportedModels(): string[] {
    const models = [...this.config.supportedModels];
    if (this.config.editModels) {
      models.push(...this.config.editModels);
    }
    return [...new Set(models)]; // 去重
  }

  /**
   * 验证请求参数
   */
  validateRequest(request: ImageGenerationRequest): string | null {
    // 验证 prompt
    if (!request.prompt && request.images.length === 0) {
      return "必须提供 prompt 或输入图片";
    }

    // 验证图片数量
    if (request.images.length > this.capabilities.maxInputImages) {
      return `最多支持 ${this.capabilities.maxInputImages} 张输入图片`;
    }

    // 验证图生图能力
    if (request.images.length > 0 && !this.capabilities.imageToImage) {
      return `${this.name} 不支持图生图功能`;
    }

    // 验证多图融合能力
    if (request.images.length > 1 && !this.capabilities.multiImageFusion) {
      return `${this.name} 不支持多图融合功能`;
    }

    return null;
  }

  /**
   * 选择合适的模型
   *
   * @param requestModel - 请求中指定的模型
   * @param hasImages - 是否有输入图片
   * @returns 选择的模型名称
   */
  protected selectModel(requestModel: string | undefined, hasImages: boolean): string {
    if (requestModel) {
      if (hasImages) {
        const editList = this.config.editModels || [];
        if (editList.includes(requestModel)) {
          return requestModel;
        }
      } else {
        const textList = this.config.supportedModels || [];
        if (textList.includes(requestModel)) {
          return requestModel;
        }
      }
    }

    if (hasImages && this.config.defaultEditModel) {
      return this.config.defaultEditModel;
    }

    return this.config.defaultModel;
  }

  /**
   * 选择合适的尺寸
   *
   * @param requestSize - 请求中指定的尺寸
   * @param hasImages - 是否有输入图片
   * @returns 选择的尺寸
   */
  protected selectSize(requestSize: string | undefined, hasImages: boolean): string {
    if (requestSize) {
      return requestSize;
    }

    // 根据是否有图片选择默认尺寸
    if (hasImages && this.config.defaultEditSize) {
      return this.config.defaultEditSize;
    }

    return this.config.defaultSize;
  }

  /**
   * 解析尺寸字符串
   *
   * @param size - 尺寸字符串，如 "1024x1024"
   * @returns 宽高对象
   */
  protected parseSize(size: string): { width: number; height: number } {
    const match = size.match(/^(\d+)x(\d+)$/);
    if (match) {
      return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
      };
    }
    return { width: 1024, height: 1024 };
  }
}
