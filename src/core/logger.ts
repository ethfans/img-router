/**
 * 日志模块 - 支持北京时间、文件输出、多级别日志
 *
 * 从根目录迁移到 src/core/ 作为核心基础设施
 */

const BEIJING_TIMEZONE_OFFSET = 8 * 60 * 60 * 1000; // UTC+8

/** 获取北京时间格式化字符串 (YYYY-MM-DD  HH:mm:ss.sss) */
function getBeijingTimestamp(): string {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + BEIJING_TIMEZONE_OFFSET);
  return beijingTime.toISOString().replace("T", "  ").replace("Z", "");
}

/** 获取北京时间日期字符串 (YYYY-MM-DD) */
function getBeijingDateString(): string {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + BEIJING_TIMEZONE_OFFSET);
  return beijingTime.toISOString().split("T")[0];
}

/** 日志级别枚举 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** 日志配置接口 */
interface LoggerConfig {
  level: LogLevel;
  fileEnabled: boolean;
  logDir: string;
}

/** 默认配置 */
let config: LoggerConfig = {
  level: LogLevel.INFO,
  fileEnabled: true,
  logDir: "./data/logs",
};

/** 日志文件句柄 */
let logFile: Deno.FsFile | null = null;

/**
 * 写入日志
 * @param level - 日志级别
 * @param module - 模块名称
 * @param message - 日志消息
 */
function writeLog(level: number, module: string, message: string): void {
  const timestamp = getBeijingTimestamp();
  const levelName = ["DEBUG", "INFO", "WARN", "ERROR"][level] || "INFO";

  // 控制台输出（带时间戳）
  if (level >= config.level) {
    console.log(`[${timestamp}] [${levelName}] [${module}] ${message}`);
  }

  // 文件输出
  if (config.fileEnabled && logFile) {
    try {
      const line = `[${timestamp}] [${levelName}] [${module}] ${message}\n`;
      logFile.writeSync(new TextEncoder().encode(line));
    } catch { /* 忽略写入错误 */ }
  }
}

/** 调试级别日志 */
export function debug(module: string, message: string): void {
  writeLog(LogLevel.DEBUG, module, message);
}

/** 信息级别日志 */
export function info(module: string, message: string): void {
  writeLog(LogLevel.INFO, module, message);
}

/** 警告级别日志 */
export function warn(module: string, message: string): void {
  writeLog(LogLevel.WARN, module, message);
}

/** 错误级别日志 */
export function error(module: string, message: string): void {
  writeLog(LogLevel.ERROR, module, message);
}

/**
 * 配置日志模块
 * @param opts - 配置选项
 */
export function configureLogger(opts: Partial<LoggerConfig>): void {
  config = { ...config, ...opts };

  const envLevel = Deno.env.get("LOG_LEVEL");
  if (envLevel) {
    if (envLevel.toUpperCase() === "DEBUG") config.level = LogLevel.DEBUG;
    else if (envLevel.toUpperCase() === "WARN") config.level = LogLevel.WARN;
    else if (envLevel.toUpperCase() === "ERROR") config.level = LogLevel.ERROR;
    else config.level = LogLevel.INFO;
  }
}

/** 初始化日志模块 */
export async function initLogger(): Promise<void> {
  try {
    await Deno.mkdir(config.logDir, { recursive: true });
  } catch { /* 目录可能已存在 */ }

  const logPath = `${config.logDir}/${getBeijingDateString()}.log`;

  try {
    logFile = await Deno.open(logPath, { create: true, append: true });
    const encoder = new TextEncoder();
    const sep = "\n" + "=".repeat(50) + "\n";
    logFile.writeSync(encoder.encode(`${sep}[${getBeijingTimestamp()}] 启动${sep}`));
  } catch {
    config.fileEnabled = false;
  }
}

/** 关闭日志模块 */
export function closeLogger(): void {
  if (logFile) {
    try {
      const encoder = new TextEncoder();
      const sep = "\n" + "=".repeat(50) + "\n";
      logFile.writeSync(encoder.encode(`${sep}[${getBeijingTimestamp()}] 关闭${sep}`));
      logFile.close();
    } catch { /* 忽略关闭错误 */ }
    logFile = null;
  }
}

/** 生成请求 ID */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/** 记录请求开始 */
export function logRequestStart(req: Request, requestId: string): void {
  writeLog(LogLevel.INFO, "HTTP", `请求 ${requestId} ${req.method} ${req.url}`);
}

/** 记录请求结束 */
export function logRequestEnd(
  requestId: string,
  method: string,
  url: string,
  status: number,
  duration: number,
  error?: string,
): void {
  const result = error ? "失败" : "成功";
  const msg = `响应 ${requestId} ${method} ${url} ${status} ${result} (${duration}ms)`;
  writeLog(error ? LogLevel.WARN : LogLevel.INFO, "HTTP", msg);
}

/** 记录 Provider 路由 */
export function logProviderRouting(provider: string, keyPrefix: string): void {
  writeLog(LogLevel.INFO, "Router", `路由 ${provider} (${keyPrefix}...)`);
}

/** 记录 API 调用开始 */
export function logApiCallStart(provider: string, op: string): void {
  writeLog(LogLevel.INFO, provider, `API ${op} 开始`);
}

/** 记录 API 调用结束 */
export function logApiCallEnd(
  provider: string,
  op: string,
  success: boolean,
  duration: number,
): void {
  const status = success ? "成功" : "失败";
  writeLog(
    success ? LogLevel.INFO : LogLevel.ERROR,
    provider,
    `API ${op} ${status} (${duration}ms)`,
  );
}

/** 记录完整 Prompt */
export function logFullPrompt(provider: string, requestId: string, prompt: string): void {
  writeLog(
    LogLevel.INFO,
    provider,
    `🤖 完整 Prompt (${requestId}):\n${"=".repeat(60)}\n${prompt}\n${"=".repeat(60)}`,
  );
}

/** 记录输入图片 */
export function logInputImages(provider: string, requestId: string, images: string[]): void {
  if (images.length > 0) {
    const formatImage = (raw: string): string => {
      const maxLen = 240;

      if (raw.startsWith("data:")) {
        const commaIndex = raw.indexOf(",");
        const meta = commaIndex >= 0 ? raw.slice(0, commaIndex) : raw.slice(0, 60);
        return `${meta},...(长度: ${raw.length})`;
      }

      if (!raw.startsWith("http")) {
        return `base64...(长度: ${raw.length})`;
      }

      if (raw.length > maxLen) {
        return `${raw.slice(0, maxLen)}...(截断)`;
      }

      return raw;
    };

    const imageList = images.map((raw, i) => `  ${i + 1}. ${formatImage(raw)}`).join("\n");
    writeLog(LogLevel.INFO, provider, `📷 输入图片 (${requestId}):\n${imageList}`);
  }
}

/** 记录图片生成开始 */
export function logImageGenerationStart(
  provider: string,
  requestId: string,
  model: string,
  size: string,
  promptLength: number,
): void {
  writeLog(
    LogLevel.INFO,
    provider,
    `🎨 开始生成图片 (${requestId}):\n  模型: ${model}\n  尺寸: ${size}\n  Prompt长度: ${promptLength} 字符`,
  );
}

/** 记录生成的图片 */
export function logGeneratedImages(
  provider: string,
  requestId: string,
  images: { url?: string; b64_json?: string }[],
): void {
  if (images.length > 0) {
    const imageUrls = images.map((img, i) => {
      if (img.url) {
        return `🖼️ 图片 ${i + 1} (${requestId}):\n  URL: ${img.url}`;
      } else if (img.b64_json) {
        return `🖼️ 图片 ${i + 1} (${requestId}):\n  Base64 (长度: ${img.b64_json.length})`;
      }
      return "";
    }).filter(Boolean).join("\n");

    writeLog(LogLevel.INFO, provider, imageUrls);
  }
}

/** 记录图片生成完成 */
export function logImageGenerationComplete(
  provider: string,
  requestId: string,
  count: number,
  duration: number,
): void {
  writeLog(
    LogLevel.INFO,
    provider,
    `✅ 图片生成完成 (${requestId}): ${count} 张图片, 耗时 ${(duration / 1000).toFixed(2)}s`,
  );
}

/** 记录图片生成失败 */
export function logImageGenerationFailed(provider: string, requestId: string, error: string): void {
  writeLog(LogLevel.ERROR, provider, `❌ 图片生成失败 (${requestId}): ${error}`);
}
