/**
 * 应用入口组装
 *
 * 负责创建和配置 HTTP 服务器，注册所有路由
 */

import { handleChatCompletions } from "./handlers/chat.ts";
import { handleImagesGenerations } from "./handlers/images.ts";
import { handleImagesEdits } from "./handlers/edits.ts";
import { warn } from "./core/logger.ts";
import { type RequestContext, withLogging } from "./middleware/logging.ts";

// CORS 响应头
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/** 健康检查响应 */
function handleHealthCheck(): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "img-router",
      endpoints: ["/v1/chat/completions", "/v1/images/generations", "/v1/images/edits"],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** CORS 预检响应 */
function handleCorsOptions(): Response {
  return new Response(null, {
    headers: corsHeaders,
  });
}

/** 404 响应 */
function handleNotFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/** 405 响应 */
function handleMethodNotAllowed(method: string): Response {
  warn("HTTP", `不支持 ${method}`);
  return new Response("Method Not Allowed", { status: 405 });
}

/**
 * 内部路由处理函数（带日志上下文）
 *
 * 这是实际的路由逻辑，由 withLogging 中间件包装
 */
async function routeRequest(req: Request, ctx: RequestContext): Promise<Response> {
  const { pathname } = ctx.url;
  const { method } = req;

  // 健康检查端点（允许 GET）
  if ((pathname === "/" || pathname === "/health") && method === "GET") {
    return handleHealthCheck();
  }

  // CORS 预检请求
  if (method === "OPTIONS") {
    return handleCorsOptions();
  }

  // 非POST 请求返回 405
  if (method !== "POST") {
    return handleMethodNotAllowed(method);
  }

  // 路由到对应的处理函数
  switch (pathname) {
    case "/v1/chat/completions":
      return await handleChatCompletions(req);
    case "/v1/images/generations":
      return await handleImagesGenerations(req);
    case "/v1/images/edits":
      return await handleImagesEdits(req);
    default:
      return handleNotFound();
  }
}

/**
 * 主路由函数：包装了日志中间件
 *
 * 这是导出给 main.ts 使用的函数，自动记录所有请求
 */
export const handleRequest = withLogging(routeRequest);
