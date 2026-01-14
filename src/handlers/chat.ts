/**
 * Chat Completions 端点处理器
 *
 * 处理 /v1/chat/completions 端点，支持流式和非流式响应
 */

import type {
  ChatRequest,
  ImageGenerationRequest,
  ImageUrlContentItem,
  Message,
  MessageContentItem,
  NonStandardImageContentItem,
  TextContentItem,
} from "../types/index.ts";
import { providerRegistry } from "../providers/registry.ts";
import { buildDataUri, normalizeAndCompressInputImages } from "../utils/image.ts";
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
 * 标准化消息内容格式：将所有非标准图片格式转换为标准 OpenAI 格式
 * 支持：
 * - Cherry Studio格式：{type:"image", image:"base64", mediaType:"image/png"}
 * - 其他未来可能出现的非标准格式
 */
export function normalizeMessageContent(
  content: string | MessageContentItem[],
): string | MessageContentItem[] {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  // 转换数组中的每个内容项
  return content.map((item: MessageContentItem) => {
    // 处理 Cherry Studio 等非标准图片格式
    if (item.type === "image" && "image" in item) {
      const nonStdItem = item as NonStandardImageContentItem;
      const mimeType = nonStdItem.mediaType || "image/png";
      const base64Data = nonStdItem.image;

      // 转换为标准 OpenAI 格式
      return {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64Data}`,
        },
      } as ImageUrlContentItem;
    }

    // 已经是标准格式，直接返回
    return item;
  });
}

/**
 * 从消息数组中提取 prompt 和图片
 * 只从最后一条用户消息中提取（不追溯历史）
 */
export function extractPromptAndImages(messages: Message[]): { prompt: string; images: string[] } {
  let prompt = "";
  const images: string[] = [];

  // 只从最后一条用户消息中提取 prompt 和图片（不追溯历史）
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const userContent = messages[i].content;
      if (typeof userContent === "string") {
        prompt = userContent; // 从字符串内容中提取 Markdown 格式的图片
        const matches = userContent.matchAll(/!\[.*?\]\(((?:https?:\/\/|data:image\/)[^\)]+)\)/g);
        for (const match of matches) {
          images.push(match[1]);
        }
      } else if (Array.isArray(userContent)) {
        const textItem = userContent.find((item: MessageContentItem) => item.type === "text") as
          | TextContentItem
          | undefined;
        prompt = textItem?.text || "";
        // 从 text 中提取 Markdown 格式的图片
        if (prompt) {
          const matches = prompt.matchAll(/!\[.*?\]\(((?:https?:\/\/|data:image\/)[^\)]+)\)/g);
          for (const match of matches) {
            images.push(match[1]);
          }
        } // 提取 image_url 类型的图片
        const imgs = userContent
          .filter((item: MessageContentItem): item is ImageUrlContentItem =>
            item.type === "image_url"
          )
          .map((item: ImageUrlContentItem) => item.image_url?.url || "")
          .filter(Boolean);
        images.push(...imgs);
      }
      break;
    }
  }

  return { prompt, images };
}

/**
 * 处理 /v1/chat/completions 端点
 */
export async function handleChatCompletions(req: Request): Promise<Response> {
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

  // 检测Provider
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

  info("HTTP", `路由到 ${provider.name}`);

  try {
    const requestBody: ChatRequest = await req.json();

    // 一劳永逸：统一标准化所有消息格式
    if (requestBody.messages && Array.isArray(requestBody.messages)) {
      requestBody.messages = requestBody.messages.map((msg) => ({
        ...msg,
        content: normalizeMessageContent(msg.content),
      }));
    }

    const isStream = requestBody.stream === true;
    const { prompt, images } = extractPromptAndImages(requestBody.messages || []);

    const compressedImages = await normalizeAndCompressInputImages(images);

    debug(
      "Router",
      `提取 Prompt: ${prompt?.substring(0, 80)}... (完整长度: ${prompt?.length || 0})`,
    );

    // 使用 Provider 生成图片
    const generationRequest: ImageGenerationRequest = {
      prompt,
      images: compressedImages,
      model: requestBody.model,
      size: requestBody.size,
      response_format: "url",
    };

    const validationError = provider.validateRequest(generationRequest);
    if (validationError) {
      warn("HTTP", `请求参数无效: ${validationError}`);
      logRequestEnd(requestId, req.method, url.pathname, 400, 0, validationError);
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const generationResult = await provider.generate(apiKey, generationRequest, { requestId });

    if (!generationResult.success) {
      throw new Error(generationResult.error || "图片生成失败");
    }

    const imageContent = (generationResult.images || [])
      .map((img, idx) => {
        if (img.url) return `![image${idx + 1}](${img.url})`;
        if (img.b64_json) return `![image${idx + 1}](${buildDataUri(img.b64_json, "image/png")})`;
        return "";
      })
      .filter(Boolean)
      .join("\n");

    const responseId = `chatcmpl-${crypto.randomUUID()}`;
    const modelName = requestBody.model || "unknown-model";
    const startTime = Date.now();

    if (isStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const contentChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
              index: 0,
              delta: { role: "assistant", content: imageContent },
              finish_reason: null,
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));

          const endChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: "stop",
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });

      info("HTTP", `响应完成 (流式)`);
      logRequestEnd(requestId, req.method, url.pathname, 200, Date.now() - startTime);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const responseBody = JSON.stringify({
      id: responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{
        index: 0,
        message: { role: "assistant", content: imageContent },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });

    info("HTTP", `响应完成 (JSON)`);
    logRequestEnd(requestId, req.method, url.pathname, 200, Date.now() - startTime);

    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal Server Error";
    const errorProvider = provider?.name || "Unknown";

    error("Proxy", `请求处理错误 (${errorProvider}): ${errorMessage}`);
    logRequestEnd(requestId, req.method, url.pathname, 500, 0, errorMessage);

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
