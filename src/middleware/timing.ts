/**
 * @fileoverview 计时中间件
 * 
 * 提供精细的 API 调用耗时统计功能。
 * 使用栈式结构支持嵌套计时，能够生成详细的性能分析报告。
 */

import { debug, logApiCallEnd, logApiCallStart } from "../core/logger.ts";

/** 模块名称 */
const MODULE = "Timing";

/**
 * 计时器接口
 * 代表一个独立的计时单元
 */
export interface Timer {
  /** 计时器名称 (操作名) */
  name: string;
  /** 开始时间戳 */
  startTime: number;
  /** 子计时器列表 (用于嵌套操作) */
  children: Timer[];
  /** 是否已结束 */
  ended: boolean;
  /** 结束时间戳 */
  endTime?: number;
  /** 持续时间 (毫秒) */
  duration?: number;
}

/**
 * 计时上下文类
 * 
 * 管理一次请求生命周期内的所有计时器。
 * 使用栈结构 (Stack) 来自动处理嵌套调用的层级关系。
 */
export class TimingContext {
  /** 根计时器 (通常代表整个请求) */
  private rootTimer: Timer;
  /** 当前活跃的计时器栈 */
  private timerStack: Timer[] = [];

  /**
   * 初始化计时上下文
   * @param name - 根操作名称
   */
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
   * 开始一个新的计时阶段
   * 新的计时器会自动作为当前活跃计时器的子节点
   * 
   * @param name - 操作名称
   * @returns 计时器 ID (目前仅用于调试或标识)
   */
  start(name: string): string {
    const timer: Timer = {
      name,
      startTime: Date.now(),
      children: [],
      ended: false,
    };

    // 将新计时器添加到父计时器的 children 中
    const parent = this.timerStack[this.timerStack.length - 1];
    if (parent) {
      parent.children.push(timer);
    }

    // 入栈，成为新的当前活跃计时器
    this.timerStack.push(timer);
    debug(MODULE, `⏱️ 开始计时: ${name}`);

    return `${name}-${timer.startTime}`;
  }

  /**
   * 结束当前活跃的计时阶段 (栈顶元素)
   * 
   * @returns 持续时间 (毫秒)
   */
  end(): number {
    if (this.timerStack.length <= 1) {
      // 保护根计时器，根计时器应通过 finish() 结束
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
   * 会自动结束该计时器之上的所有未结束计时器 (栈回溯)
   * 
   * @param name - 要结束的计时器名称
   * @returns 持续时间 (毫秒)，未找到返回 -1
   */
  endByName(name: string): number {
    // 从栈顶向下查找
    for (let i = this.timerStack.length - 1; i >= 0; i--) {
      if (this.timerStack[i].name === name) {
        const timer = this.timerStack[i];
        timer.endTime = Date.now();
        timer.duration = timer.endTime - timer.startTime;
        timer.ended = true;

        // 移除该计时器及其之上的所有元素
        this.timerStack.splice(i);

        debug(MODULE, `⏱️ 结束计时: ${timer.name} (${timer.duration}ms)`);
        return timer.duration;
      }
    }
    return -1;
  }

  /**
   * 完成整个上下文的计时
   * 强制结束所有未闭合的计时器，并计算总耗时
   * 
   * @returns 总持续时间 (毫秒)
   */
  finish(): number {
    // 清空栈，标记所有未结束的计时器为结束
    while (this.timerStack.length > 0) {
      const timer = this.timerStack.pop();
      if (timer && !timer.ended) {
        timer.endTime = Date.now();
        timer.duration = timer.endTime - timer.startTime;
        timer.ended = true;
      }
    }

    // 确保根计时器正确结束
    this.rootTimer.endTime = Date.now();
    this.rootTimer.duration = this.rootTimer.endTime - this.rootTimer.startTime;
    this.rootTimer.ended = true;

    debug(MODULE, `⏱️ 完成总计时: ${this.rootTimer.duration}ms`);

    return this.rootTimer.duration;
  }

  /**
   * 获取当前总耗时
   * 如果已结束返回最终耗时，否则返回当前流逝时间
   * 
   * @returns 持续时间 (毫秒)
   */
  getDuration(): number {
    if (this.rootTimer.ended && this.rootTimer.duration !== undefined) {
      return this.rootTimer.duration;
    }
    return Date.now() - this.rootTimer.startTime;
  }

  /**
   * 生成层级化的计时报告
   * 
   * @returns 包含各阶段耗时的报告对象
   */
  getReport(): {
    name: string;
    duration: number;
    children: Array<{ name: string; duration: number }>;
  } {
    // 递归收集子节点信息
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
 * API 调用自动计时包装器
 * 
 * 用于包装对外部 API 的调用，自动记录开始和结束日志以及耗时。
 * 
 * @param {string} provider - 服务提供商名称
 * @param {string} apiType - API 操作类型 (如 "generate_image")
 * @param {Function} fn - 要执行的异步函数
 * @returns {Promise<T>} 函数执行结果
 * 
 * @example
 * ```typescript
 * const result = await withApiTiming("Doubao", "generate", async () => {
 *   return await client.createImage({...});
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
 * 简单的异步函数计时工具
 * 仅记录 DEBUG 级别的开始和结束日志
 * 
 * @param {string} name - 操作名称
 * @param {Function} fn - 要执行的异步函数
 * @returns {Promise<T>} 函数执行结果
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
 * 创建计时上下文的工厂函数
 * 
 * @param {string} [name] - 根计时器名称
 * @returns {TimingContext} 新的计时上下文实例
 */
export function createTimingContext(name?: string): TimingContext {
  return new TimingContext(name);
}
