import { pino, type Logger } from "pino";
import type { Env } from "./env";

export function createLogger(env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">): Logger {
  return pino({
    level: env.LOG_LEVEL,
    // Never log credentials or session cookies.
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
      censor: "[redacted]",
    },
    ...(env.NODE_ENV === "development" && {
      transport: {
        target: "pino-pretty",
        options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      },
    }),
  });
}
