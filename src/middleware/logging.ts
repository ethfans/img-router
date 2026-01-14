/**
 * 日志中间件
 *
 * 提供请求日志记录功能，包括请求开始、结束和错误记录
 */

import {
  error as logError,
  generateRequestId,
  info,
  logRequestEnd,
  logRequestStart,
  warn,
} from "../core/logger.ts";

/** 模块名称 */
const MODULE = "Middleware";

/**
 * 请求上下文，包含请求 ID 和开始时间
 */
export interface RequestContext {
  /** 唯一请求 ID */
  requestId: string;
  /** 请求开始时间戳 */
  startTime: number;
  /** 原始请求对象 */
  request: Request;
  /** URL 对象 */
  url: URL;
}

/**
 * 创建请求上下文
 *
 * @param req 原始请求对象
 * @returns 请求上下文
 */
export function createRequestContext(req: Request): RequestContext {
  const requestId = generateRequestId();
  const url = new URL(req.url);

  // 记录请求开始
  logRequestStart(req, requestId);

  return {
    requestId,
    startTime: Date.now(),
    request: req,
    url,
  };
}

/**
 * 完成请求日志
 *
 * @param ctx 请求上下文
 * @param statusCode HTTP 状态码
 * @param errorMessage 可选的错误消息
 */
export async function completeRequestLog(
  ctx: RequestContext,
  statusCode: number,
  errorMessage?: string,
): Promise<void> {
  const duration = Date.now() - ctx.startTime;
  await logRequestEnd(
    ctx.requestId,
    ctx.request.method,
    ctx.url.pathname,
    statusCode,
    duration,
    errorMessage,
  );
}

/**
 * 日志中间件类型
 */
export type Handler = (
  req: Request,
  ctx: RequestContext,
) => Promise<Response>;

/**
 * 包装处理函数，添加日志记录功能
 *
 * @param handler 原始处理函数
 * @returns 包装后的处理函数
 *
 * @example
 * ```typescript
 * const handleChat = withLogging(async (req, ctx) => {
 *   // 处理逻辑
 *   return new Response("OK");
 * });
 * ```
 */
export function withLogging(handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const ctx = createRequestContext(req);

    try {
      const response = await handler(req, ctx);

      // 记录成功响应
      await completeRequestLog(ctx, response.status);

      return response;
    } catch (err) {
      // 记录错误
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError(MODULE, `请求处理错误: ${errorMessage}`);
      await completeRequestLog(ctx, 500, errorMessage);

      // 返回错误响应
      return new Response(
        JSON.stringify({
          error: {
            message: errorMessage,
            type: "server_error",
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

/**
 * 记录路由信息
 *
 * @param provider 服务提供商名称
 * @param endpoint 端点路径
 */
export function logRouting(provider: string, endpoint: string): void {
  info(MODULE, `路由到 ${provider} (${endpoint})`);
}

/**
 * 记录认证警告
 *
 * @param message 警告消息
 */
export function logAuthWarning(message: string): void {
  warn(MODULE, message);
}

/**
 * 记录请求处理错误
 *
 * @param provider 服务提供商名称
 * @param message 错误消息
 */
export function logHandlerError(provider: string, message: string): void {
  logError(MODULE, `请求处理错误 (${provider}): ${message}`);
}

// 导出类型
export type { RequestContext as LoggingContext };
