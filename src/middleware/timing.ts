/**
 * 计时中间件
 *
 * 提供 API 调用计时功能，记录各个阶段的耗时
 */

import { debug, logApiCallEnd, logApiCallStart } from "../core/logger.ts";

/** 模块名称 */
const MODULE = "Timing";

/**
 * 计时器接口
 */
export interface Timer {
  /** 计时器名称 */
  name: string;
  /** 开始时间戳 */
  startTime: number;
  /** 子计时器 */
  children: Timer[];
  /** 是否已结束 */
  ended: boolean;
  /** 结束时间戳 */
  endTime?: number;
  /** 持续时间（毫秒） */
  duration?: number;
}

/**
 * 计时上下文
 *
 * 用于跟踪一次请求中的多个计时器
 */
export class TimingContext {
  /** 根计时器 */
  private rootTimer: Timer;
  /** 当前活动的计时器栈 */
  private timerStack: Timer[] = [];

  constructor(name: string = "request") {
    this.rootTimer = {
      name,
      startTime: Date.now(),
      children: [],
      ended: false,
    };
    this.timerStack.push(this.rootTimer);
  }

  /**
   * 开始一个新的计时器
   *
   * @param name 计时器名称
   * @returns 计时器 ID（用于结束计时）
   */
  start(name: string): string {
    const timer: Timer = {
      name,
      startTime: Date.now(),
      children: [],
      ended: false,
    };

    // 添加到父计时器的子列表
    const parent = this.timerStack[this.timerStack.length - 1];
    if (parent) {
      parent.children.push(timer);
    }

    this.timerStack.push(timer);
    debug(MODULE, `⏱️ 开始计时: ${name}`);

    return `${name}-${timer.startTime}`;
  }

  /**
   * 结束当前活动的计时器
   *
   * @returns 持续时间（毫秒）
   */
  end(): number {
    if (this.timerStack.length <= 1) {
      // 不能结束根计时器，使用 finish() 代替
      return 0;
    }

    const timer = this.timerStack.pop();
    if (!timer) return 0;

    timer.endTime = Date.now();
    timer.duration = timer.endTime - timer.startTime;
    timer.ended = true;

    debug(MODULE, `⏱️ 结束计时: ${timer.name} (${timer.duration}ms)`);

    return timer.duration;
  }

  /**
   * 结束指定名称的计时器
   *
   * @param name 计时器名称
   * @returns 持续时间（毫秒），如果未找到则返回 -1
   */
  endByName(name: string): number {
    // 从栈顶向下查找
    for (let i = this.timerStack.length - 1; i >= 0; i--) {
      if (this.timerStack[i].name === name) {
        const timer = this.timerStack[i];
        timer.endTime = Date.now();
        timer.duration = timer.endTime - timer.startTime;
        timer.ended = true;

        // 移除该计时器及其之后的所有计时器
        this.timerStack.splice(i);

        debug(MODULE, `⏱️ 结束计时: ${timer.name} (${timer.duration}ms)`);
        return timer.duration;
      }
    }
    return -1;
  }

  /**
   * 完成整个计时上下文
   *
   * @returns 总持续时间（毫秒）
   */
  finish(): number {
    // 结束所有未结束的计时器
    while (this.timerStack.length > 0) {
      const timer = this.timerStack.pop();
      if (timer && !timer.ended) {
        timer.endTime = Date.now();
        timer.duration = timer.endTime - timer.startTime;
        timer.ended = true;
      }
    }

    this.rootTimer.endTime = Date.now();
    this.rootTimer.duration = this.rootTimer.endTime - this.rootTimer.startTime;
    this.rootTimer.ended = true;

    debug(MODULE, `⏱️ 完成总计时: ${this.rootTimer.duration}ms`);

    return this.rootTimer.duration;
  }

  /**
   * 获取总持续时间
   *
   * @returns 持续时间（毫秒）
   */
  getDuration(): number {
    if (this.rootTimer.ended && this.rootTimer.duration !== undefined) {
      return this.rootTimer.duration;
    }
    return Date.now() - this.rootTimer.startTime;
  }

  /**
   * 获取计时报告
   *
   * @returns 计时报告对象
   */
  getReport(): {
    name: string;
    duration: number;
    children: Array<{ name: string; duration: number }>;
  } {
    const collectChildren = (timer: Timer): Array<{ name: string; duration: number }> => {
      const result: Array<{ name: string; duration: number }> = [];
      for (const child of timer.children) {
        if (child.ended && child.duration !== undefined) {
          result.push({ name: child.name, duration: child.duration });
        }
        result.push(...collectChildren(child));
      }
      return result;
    };

    return {
      name: this.rootTimer.name,
      duration: this.getDuration(),
      children: collectChildren(this.rootTimer),
    };
  }
}

/**
 * API 调用计时包装器
 *
 * 包装一个异步函数，自动记录其执行时间
 *
 * @param provider 服务提供商名称
 * @param apiType API 类型
 * @param fn 要包装的异步函数
 * @returns 包装后的函数
 *
 * @example
 * ```typescript
 * const result = await withApiTiming("Doubao", "generate_image", async () => {
 *   // API 调用逻辑
 *   return imageData;
 * });
 * ```
 */
export async function withApiTiming<T>(
  provider: string,
  apiType: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  logApiCallStart(provider, apiType);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    logApiCallEnd(provider, apiType, true, duration);
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logApiCallEnd(provider, apiType, false, duration);
    throw err;
  }
}

/**
 * 简单计时函数
 *
 * @param name 计时名称
 * @param fn 要计时的异步函数
 * @returns 函数执行结果
 *
 * @example
 * ```typescript
 * const data = await timed("download_image", async () => {
 *   return await fetch(url);
 * });
 * ```
 */
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now();
  debug(MODULE, `⏱️ 开始: ${name}`);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    debug(MODULE, `⏱️ 完成: ${name} (${duration}ms)`);
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    debug(MODULE, `⏱️ 失败: ${name} (${duration}ms)`);
    throw err;
  }
}

/**
 * 创建计时上下文工厂函数
 *
 * @param name 根计时器名称
 * @returns 新的计时上下文
 */
export function createTimingContext(name?: string): TimingContext {
  return new TimingContext(name);
}
