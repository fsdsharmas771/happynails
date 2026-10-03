import { Redis } from "ioredis";
import type { Logger } from "pino";

export function createRedis(url: string, log: Logger): Redis {
  // No offline queue: commands fail fast while Redis is down instead of hanging the request.
  const redis = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  redis.on("ready", () => log.info("redis connected"));
  redis.on("error", (err) => log.warn({ err: err.message }, "redis error"));
  return redis;
}

export async function pingRedis(redis: Redis): Promise<boolean> {
  return (await redis.ping()) === "PONG";
}
