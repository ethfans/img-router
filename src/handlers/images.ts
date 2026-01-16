/**
 * Images Generations 端点处理器
 *
 * 处理 /v1/images/generations 端点（文生图）。
 * 
 * 功能特性：
 * - **自动路由**：根据 Authorization Header 中的 API Key 自动路由到对应的 Provider。
 * - **双模式支持**：支持中转模式 (Relay) 和后端模式 (Backend)。
 * - **后端模式增强**：在后端模式下，支持自动从密钥池分配 Key，并具备错误重试机制。
 * - **格式兼容**：返回 OpenAI Images API 兼容的响应格式。
 *
 * 兼容策略：
 * - 如果请求 response_format="b64_json"：尽量返回 b64_json（必要时从 url 下载转 Base64）。
 * - 如果请求 response_format="url" 或未指定：优先返回 url；若只有 b64_json，则返回 data URI 作为 url（多数客户端可直接渲染）。
 */

import { getSystemConfig, getNextAvailableKey, reportKeyError, reportKeySuccess } from "../config/manager.ts";
import type { IProvider } from "../providers/base.ts";
import type {
  ImageData,
  ImageGenerationRequest,
  ImagesRequest,
  ImagesResponse,
  GenerationResult,
} from "../types/index.ts";
import { providerRegistry } from "../providers/registry.ts";
import { buildDataUri, urlToBase64 } from "../utils/image.ts";
import {
  debug,
  error,
  generateRequestId,
  info,
  logRequestEnd,
  warn,
} from "../core/logger.ts";

/**
 * 处理 /v1/images/generations 端点
 * 
 * 核心流程：
 * 1. **鉴权与路由**：根据 Key 格式判断是中转模式还是后端模式。
 * 2. **后端模式逻辑**：
 *    - 验证 Global Key。
 *    - 根据 Model 选择 Provider。
 *    - 从密钥池获取可用 Key。
 * 3. **请求校验**：检查参数有效性。
 * 4. **执行生成（带重试）**：
 *    - 后端模式下，如果遇到速率限制或鉴权错误，会自动换 Key 重试。
 *    - 中转模式不重试。
 * 5. **响应构建**：格式化输出，处理 `response_format` 转换。
 *
 * @param req - HTTP 请求对象
 * @returns HTTP 响应对象
 */
export async function handleImagesGenerations(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requestId = generateRequestId();
  const systemConfig = getSystemConfig();
  const modes = systemConfig.modes || { relay: true, backend: false };

  // 0. 检查系统是否完全关闭（双关模式）
  if (!modes.relay && !modes.backend) {
    warn("HTTP", "系统服务未启动：中转模式和后端模式均已关闭");
    // logRequestEnd 由 middleware 统一记录
    return new Response(
      JSON.stringify({ error: "服务未启动：请开启中转模式或后端模式" }), 
      { 
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  // logRequestStart(req, requestId);

  const authHeader = req.headers.get("Authorization");
  let apiKey = authHeader?.replace("Bearer ", "").trim() || "";
  
  // 1. 尝试检测 Provider (基于 Key 格式)
  let provider: IProvider | undefined = providerRegistry.detectProvider(apiKey);
  let usingBackendMode = false;

  // 2. 路由逻辑
  if (provider) {
    // Case A: 识别到 Provider Key
    if (!modes.relay) {
       warn("HTTP", "中转模式已禁用，拒绝外部 Provider Key");
       // logRequestEnd 由 middleware 统一记录
       return new Response(JSON.stringify({ error: "Relay mode is disabled" }), { 
         status: 403,
         headers: { "Content-Type": "application/json" }
       });
    }
    // 继续使用该 Provider 和 Key
  } else {
    // Case B: 未识别到 Key (可能是空，可能是系统 Key，可能是无效 Key)
    // 尝试后端模式
    if (modes.backend) {
       // 验证是否允许访问后端模式
       // 如果设置了 Global Key，必须匹配
       if (systemConfig.globalAccessKey && apiKey !== systemConfig.globalAccessKey) {
          warn("HTTP", "鉴权失败: 非有效 Provider Key 且不匹配 Global Key");
          // logRequestEnd 由 middleware 统一记录
          return new Response(JSON.stringify({ error: "Unauthorized" }), { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
       }
       
       usingBackendMode = true;
       // 后续需要从 Body 解析 Model 来确定 Provider
    } else {
       // 后端模式关闭，且 Key 无效
       warn("HTTP", "无法识别 Key 且后端模式未开启");
       // logRequestEnd 由 middleware 统一记录
       return new Response(JSON.stringify({ error: "Invalid API Key" }), { 
         status: 401,
         headers: { "Content-Type": "application/json" }
       });
    }
  }

  if (!usingBackendMode && provider) {
    info("HTTP", `路由到 ${provider.name} (Relay Mode)`);
  }

  const startTime = Date.now();

  try {
    const requestBody: ImagesRequest = await req.json();

    // 如果是后端模式，现在需要确定 Provider 和 Key
    if (usingBackendMode) {
        if (!requestBody.model) {
            warn("HTTP", "后端模式下请求缺失 model 参数");
            logRequestEnd(requestId, req.method, url.pathname, 400, 0, "missing model");
            return new Response(JSON.stringify({ error: "Missing 'model' parameter in backend mode" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }
        provider = providerRegistry.getProviderByModel(requestBody.model);
        if (!provider) {
            warn("HTTP", `后端模式下请求了不支持的模型: ${requestBody.model}`);
            logRequestEnd(requestId, req.method, url.pathname, 400, 0, "unsupported model");
            return new Response(JSON.stringify({ error: `Unsupported model: ${requestBody.model}` }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }
        
        info("HTTP", `路由到 ${provider.name} (Backend Mode)`);
    }

    if (!provider) {
        throw new Error("内部错误: Provider 未定义");
    }

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

    // 重试循环 (仅限后端模式)
    let attempts = 0;
    const maxAttempts = usingBackendMode ? 3 : 1;
    let lastError: string | null = null;
    let successResult: GenerationResult | null = null;

    while (attempts < maxAttempts) {
        attempts++;
        
        // 后端模式：每次尝试都重新获取一个 Key (如果是重试)
        if (usingBackendMode) {
             const poolKey = getNextAvailableKey(provider.name);
             if (!poolKey) {
                 if (attempts === 1) {
                    warn("HTTP", `Provider ${provider.name} 账号池耗尽`);
                    logRequestEnd(requestId, req.method, url.pathname, 503, 0, "key pool exhausted");
                    return new Response(JSON.stringify({ error: `No available API keys for provider: ${provider.name}` }), {
                        status: 503,
                        headers: { "Content-Type": "application/json" }
                    });
                 } else {
                    // 重试时耗尽了 Key，退出循环
                    warn("Router", `重试期间 Key 耗尽`);
                    break;
                 }
             }
             apiKey = poolKey;
             info("Router", `后端模式: 为 ${provider.name} 分配了 Key (ID: ...${apiKey.slice(-4)}) (尝试 ${attempts}/${maxAttempts})`);
        }

        const generationResult = await provider.generate(apiKey, generationRequest, { requestId });
        
        if (generationResult.success) {
            successResult = generationResult;
            if (usingBackendMode) {
                reportKeySuccess(provider.name, apiKey);
            }
            break; 
        } else {
            lastError = generationResult.error || "Unknown error";
            
            if (usingBackendMode) {
                // 简单的关键词匹配，实际应根据 Provider 返回的错误码判断
                const isRateLimit = lastError.includes("429") || lastError.includes("rate limit") || lastError.includes("速率限制");
                const isAuthError = lastError.includes("401") || lastError.includes("403") || lastError.includes("API Key") || lastError.includes("Unauthorized");
                
                if (isRateLimit) {
                    warn("Router", `Key ...${apiKey.slice(-4)} 触发速率限制，标记并重试...`);
                    reportKeyError(provider.name, apiKey, 'rate_limit');
                } else if (isAuthError) {
                    warn("Router", `Key ...${apiKey.slice(-4)} 鉴权失败，标记并重试...`);
                    reportKeyError(provider.name, apiKey, 'auth_error');
                } else {
                    // 其他错误也记录，避免坏节点一直被使用
                    reportKeyError(provider.name, apiKey, 'other');
                    // 如果不是 429/401，也许不应该重试？为了稳健性，如果是 5xx 也可以重试。
                    // 这里我们继续重试，直到次数耗尽
                }
            } else {
                // 中转模式不重试
                break;
            }
        }
    }

    if (!successResult) {
      throw new Error(lastError || "图片生成失败");
    }
    
    const generationResult = successResult;

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
