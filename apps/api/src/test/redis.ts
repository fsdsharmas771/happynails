import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeEach } from "vitest";

/**
 * Real Redis from the dev stack, isolated by a random key prefix per test file.
 * Keys under the prefix are cleared before each test and when the file finishes.
 */
export function useTestRedis(): { redis: Redis; keyPrefix: string } {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set; run tests inside the api container");
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  const keyPrefix = `hn_test_${randomBytes(4).toString("hex")}:`;

  async function clear() {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${keyPrefix}*`, "COUNT", 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  }

  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await redis.quit();
  });
  return { redis, keyPrefix };
}
