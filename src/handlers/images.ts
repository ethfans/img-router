/**
 * Images Generations 端点处理器
 *
 * 处理 /v1/images/generations 端点（文生图）
 * - 根据 Authorization Bearer API Key 自动路由到对应 Provider
 * - 返回 OpenAI Images API 兼容格式：{ created, data: [{ url? | b64_json? }] }
 *
 * 兼容策略：
 * - 如果请求 response_format="b64_json"：尽量返回 b64_json（必要时从 url 下载转 Base64）
 * - 如果请求 response_format="url" 或未指定：优先返回 url；若只有 b64_json，则返回 data URI 作为 url（多数客户端可直接渲染）
 */

import type {
  ImageData,
  ImageGenerationRequest,
  ImagesRequest,
  ImagesResponse,
} from "../types/index.ts";
import { providerRegistry } from "../providers/registry.ts";
import { buildDataUri, urlToBase64 } from "../utils/image.ts";
import {
  debug,
  error,
  generateRequestId,
  info,
  logRequestEnd,
  logRequestStart,
  warn,
} from "../core/logger.ts";

/**
 * 处理 /v1/images/generations 端点
 */
export async function handleImagesGenerations(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requestId = generateRequestId();

  logRequestStart(req, requestId);

  const authHeader = req.headers.get("Authorization");
  const apiKey = authHeader?.replace("Bearer ", "").trim();
  if (!apiKey) {
    warn("HTTP", "Authorization header 缺失");
    logRequestEnd(requestId, req.method, url.pathname, 401, 0, "missing auth");
    return new Response(JSON.stringify({ error: "Authorization header missing" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const provider = providerRegistry.detectProvider(apiKey);
  if (!provider) {
    warn("HTTP", "API Key 格式无法识别");
    logRequestEnd(requestId, req.method, url.pathname, 401, 0, "invalid key");
    return new Response(
      JSON.stringify({ error: "Invalid API Key format. Could not detect provider." }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  info("HTTP", `路由到 ${provider.name} (Images Generations)`);

  const startTime = Date.now();

  try {
    const requestBody: ImagesRequest = await req.json();

    const prompt = requestBody.prompt || "";
    const desiredFormat = requestBody.response_format || "url";

    debug(
      "Router",
      `Images API Prompt: ${prompt.substring(0, 80)}... (完整长度: ${prompt.length})`,
    );

    const generationRequest: ImageGenerationRequest = {
      prompt,
      images: [],
      model: requestBody.model,
      size: requestBody.size,
      n: requestBody.n,
      response_format: desiredFormat,
    };

    const validationError = provider.validateRequest(generationRequest);
    if (validationError) {
      warn("HTTP", `请求参数无效: ${validationError}`);
      logRequestEnd(
        requestId,
        req.method,
        url.pathname,
        400,
        Date.now() - startTime,
        validationError,
      );
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const generationResult = await provider.generate(apiKey, generationRequest, { requestId });
    if (!generationResult.success) {
      throw new Error(generationResult.error || "图片生成失败");
    }

    const images: ImageData[] = generationResult.images || [];

    const data: ImageData[] = [];
    for (const img of images) {
      if (desiredFormat === "b64_json") {
        if (img.b64_json) {
          data.push({ b64_json: img.b64_json });
          continue;
        }
        if (img.url) {
          try {
            const { base64 } = await urlToBase64(img.url);
            data.push({ b64_json: base64 });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            warn("HTTP", `URL 转 Base64 失败，回退到 URL: ${msg}`);
            data.push({ url: img.url });
          }
          continue;
        }
        continue;
      }

      // desiredFormat === "url"（或默认）
      if (img.url) {
        data.push({ url: img.url });
        continue;
      }
      if (img.b64_json) {
        // 兼容旧实现：将 Base64 作为 data URI 放入 url 字段，便于客户端直接渲染
        data.push({ url: buildDataUri(img.b64_json, "image/png") });
        continue;
      }
    }

    const responseBody: ImagesResponse = {
      created: Math.floor(Date.now() / 1000),
      data,
    };

    info("HTTP", "响应完成 (Images API)");
    logRequestEnd(requestId, req.method, url.pathname, 200, Date.now() - startTime);

    return new Response(JSON.stringify(responseBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal Server Error";
    const errorProvider = provider?.name || "Unknown";

    error("Proxy", `请求处理错误 (${errorProvider}): ${errorMessage}`);
    logRequestEnd(requestId, req.method, url.pathname, 500, Date.now() - startTime, errorMessage);

    return new Response(
      JSON.stringify({
        error: { message: errorMessage, type: "server_error", provider: errorProvider },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
