import { pino, stdSerializers, type Logger } from "pino";
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

/** Hides `token=` values (customer order and booking access links) in a URL or Referer. */
export const redactTokens = (s: string) => s.replace(/([?&]token=)[^&#]*/gi, "$1[redacted]");

/**
 * Request serializer for pino-http: tracking and invoice links carry the customer's access token
 * in the query string, so it is removed from the logged URL, query and Referer.
 */
export const requestSerializer = stdSerializers.wrapRequestSerializer((r) => {
  const headers = { ...r.headers };
  if (typeof headers.referer === "string") headers.referer = redactTokens(headers.referer);
  const query =
    r.query && typeof r.query === "object" ? { ...(r.query as Record<string, unknown>) } : r.query;
  if (query && typeof query === "object" && "token" in query) query.token = "[redacted]";
  return { ...r, url: redactTokens(r.url), query, headers } as typeof r;
});
