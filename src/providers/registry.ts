/**
 * Provider 注册表
 *
 * 管理所有图片生成 Provider 的注册和获取
 */

import type { IProvider, ProviderCapabilities, ProviderConfig, ProviderName } from "./base.ts";
import { doubaoProvider } from "./doubao.ts";
import { giteeProvider } from "./gitee.ts";
import { modelScopeProvider } from "./modelscope.ts";
import { huggingFaceProvider } from "./huggingface.ts";
import { pollinationsProvider } from "./pollinations.ts";
import { debug, info, logProviderRouting, warn } from "../core/logger.ts";

/** 模块名称，用于日志 */
const MODULE = "Registry";

/**
 * Provider 注册信息
 */
interface ProviderRegistration {
  /** Provider 实例 */
  instance: IProvider;
  /** 是否默认启用 */
  enabled: boolean;
}

/**
 * Provider 注册表类
 *
 * 负责管理所有可用的 Provider，提供获取、过滤等功能
 */
class ProviderRegistry {
  /** 已注册的 Provider */
  private registrations = new Map<ProviderName, ProviderRegistration>();

  constructor() {
    // 注册所有内置 Provider
    this.registerBuiltinProviders();
  }

  /**
   * 注册内置 Provider
   */
  private registerBuiltinProviders(): void {
    const builtinProviders = [
      doubaoProvider,
      giteeProvider,
      modelScopeProvider,
      huggingFaceProvider,
      pollinationsProvider,
    ];

    for (const provider of builtinProviders) {
      this.register(provider);
    }

    debug(
      MODULE,
      `已注册所有内置 Provider，共 ${this.registrations.size} 个: ${
        Array.from(this.registrations.keys()).join(", ")
      }`,
    );
  }

  /**
   * 注册一个 Provider
   */
  register(provider: IProvider, enabled = true): void {
    if (this.registrations.has(provider.name)) {
      warn(MODULE, `Provider ${provider.name} 已存在，将被覆盖`);
    }
    this.registrations.set(provider.name, { instance: provider, enabled });
    debug(MODULE, `已注册 Provider: ${provider.name}`);
  }

  /**
   * 注销一个 Provider
   */
  unregister(name: ProviderName): boolean {
    const deleted = this.registrations.delete(name);
    if (deleted) {
      debug(MODULE, `已注销 Provider: ${name}`);
    }
    return deleted;
  }

  /**
   * 获取 Provider 实例
   *
   * @param name Provider 名称
   * @returns Provider 实例，如果不存在则返回 undefined
   */
  get(name: ProviderName): IProvider | undefined {
    const reg = this.registrations.get(name);
    if (!reg) {
      warn(MODULE, `未找到 Provider: ${name}`);
      return undefined;
    }

    if (!reg.enabled) {
      warn(MODULE, `Provider ${name} 已禁用`);
      return undefined;
    }

    return reg.instance;
  }

  /**
   * 获取 Provider 实例（如果不存在则抛出错误）
   */
  getOrThrow(name: ProviderName): IProvider {
    const provider = this.get(name);
    if (!provider) {
      throw new Error(`Provider not found: ${name}`);
    }
    return provider;
  }

  /**
   * 检查 Provider 是否存在且启用
   */
  has(name: ProviderName): boolean {
    const reg = this.registrations.get(name);
    return reg !== undefined && reg.enabled;
  }

  /**
   * 获取所有已注册的 Provider 名称
   */
  getNames(): ProviderName[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * 获取所有启用的 Provider 名称
   */
  getEnabledNames(): ProviderName[] {
    return Array.from(this.registrations.entries())
      .filter(([_, reg]) => reg.enabled)
      .map(([name, _]) => name);
  }

  /**
   * 获取所有 Provider 的配置信息
   */
  getAllConfigs(): ProviderConfig[] {
    return Array.from(this.registrations.values())
      .filter((reg) => reg.enabled)
      .map((reg) => reg.instance.config);
  }

  /**
   * 获取 Provider 的能力信息
   */
  getCapabilities(name: ProviderName): ProviderCapabilities | undefined {
    return this.registrations.get(name)?.instance.capabilities;
  }

  /**
   * 根据能力过滤 Provider
   */
  filterByCapability(filter: Partial<ProviderCapabilities>): ProviderName[] {
    return Array.from(this.registrations.entries())
      .filter(([_, reg]) => {
        if (!reg.enabled) return false;
        const caps = reg.instance.capabilities;
        if (filter.textToImage !== undefined && caps.textToImage !== filter.textToImage) {
          return false;
        }
        if (filter.imageToImage !== undefined && caps.imageToImage !== filter.imageToImage) {
          return false;
        }
        if (
          filter.multiImageFusion !== undefined && caps.multiImageFusion !== filter.multiImageFusion
        ) return false;
        if (filter.asyncTask !== undefined && caps.asyncTask !== filter.asyncTask) return false;
        return true;
      })
      .map(([name, _]) => name);
  }

  /**
   * 启用指定的 Provider
   */
  enable(name: ProviderName): boolean {
    const reg = this.registrations.get(name);
    if (reg) {
      reg.enabled = true;
      info(MODULE, `已启用 Provider: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 禁用指定的 Provider
   */
  disable(name: ProviderName): boolean {
    const reg = this.registrations.get(name);
    if (reg) {
      reg.enabled = false;
      info(MODULE, `已禁用 Provider: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 获取注册表状态摘要
   */
  getSummary() {
    const providers = Array.from(this.registrations.entries()).map(([name, reg]) => ({
      name,
      enabled: reg.enabled,
      capabilities: reg.instance.capabilities,
    }));

    return {
      total: this.registrations.size,
      enabled: providers.filter((p) => p.enabled).length,
      disabled: providers.filter((p) => !p.enabled).length,
      providers,
    };
  }

  /**
   * 根据 API Key 格式检测 Provider
   *
   * @param apiKey API密钥
   * @returns Provider 实例，如果无法识别则返回 undefined
   */
  detectProvider(apiKey: string): IProvider | undefined {
    if (!apiKey) return undefined;

    // 遍历所有已注册且启用的 Provider，调用它们的 detectApiKey 方法
    for (const reg of this.registrations.values()) {
      if (reg.enabled && reg.instance.detectApiKey(apiKey)) {
        logProviderRouting(reg.instance.name, apiKey.substring(0, 4));
        return reg.instance;
      }
    }

    logProviderRouting("Unknown", apiKey.substring(0, 4));
    return undefined;
  }
}

// 导出单例实例
export const providerRegistry = new ProviderRegistry();

// 便捷函数导出
export const getProvider = (name: ProviderName) => providerRegistry.get(name);
export const getProviderOrThrow = (name: ProviderName) => providerRegistry.getOrThrow(name);
export const hasProvider = (name: ProviderName) => providerRegistry.has(name);
export const getProviderNames = () => providerRegistry.getNames();
export const getEnabledProviders = () => providerRegistry.getEnabledNames();
