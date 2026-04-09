type LogLevel = "info" | "warn" | "error" | "debug";

const log = (level: LogLevel, message: string, meta?: unknown): void => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta !== undefined ? { meta } : {})
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
};

export const logger = {
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta),
  debug: (message: string, meta?: unknown) => log("debug", message, meta)
};
