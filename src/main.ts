/**
 * 应用入口点
 *
 * 负责初始化日志系统、启动 HTTP 服务器、处理进程信号
 */

import { handleRequest } from "./app.ts";
import { PORT } from "./config/index.ts";
import { closeLogger, configureLogger, info, initLogger, LogLevel } from "./core/logger.ts";

/** 读取版本号 */
async function getVersion(): Promise<string> {
  try {
    const denoJson = await Deno.readTextFile("./deno.json");
    const config = JSON.parse(denoJson);
    return config.version || "unknown";
  } catch {
    return "unknown";
  }
}

// 初始化日志系统
await initLogger();

// 根据环境变量配置日志级别
const logLevel = Deno.env.get("LOG_LEVEL")?.toUpperCase();
if (logLevel && logLevel in LogLevel) {
  configureLogger({ level: LogLevel[logLevel as keyof typeof LogLevel] });
}

// 读取版本号并输出启动信息
const version = await getVersion();
info("Startup", `🚀 服务启动端口 ${PORT}`);
info("Startup", `📦 版本: ${version}`);
info("Startup", "🔧 支持: 豆包, Gitee, ModelScope, HuggingFace, Pollinations");
info("Startup", "📡 端点: /v1/chat/completions, /v1/images/generations, /v1/images/edits");
info("Startup", `📁 日志目录: ./data/logs`);

// 监听 SIGINT 信号（Ctrl+C）
Deno.addSignalListener("SIGINT", async () => {
  info("Startup", "收到 SIGINT, 关闭服务...");
  await closeLogger();
  Deno.exit(0);
});

// Windows 不支持 SIGTERM，仅在非 Windows 系统上监听
// 感谢 @johnnyee 在 PR #3 中提出的修复方案
if (Deno.build.os !== "windows") {
  Deno.addSignalListener("SIGTERM", async () => {
    info("Startup", "收到 SIGTERM, 关闭服务...");
    await closeLogger();
    Deno.exit(0);
  });
}

// 启动 HTTP 服务器
Deno.serve({ port: PORT }, handleRequest);
