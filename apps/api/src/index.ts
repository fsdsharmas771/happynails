import { createApp } from "./app";
import { connectMongo, disconnectMongo, pingMongo } from "./db/mongo";
import { createRedis, pingRedis } from "./db/redis";
import { loadEnv } from "./env";
import { createLogger } from "./logger";

const env = loadEnv();
const logger = createLogger(env);
const redis = createRedis(env.REDIS_URL, logger);

const app = createApp({
  logger,
  allowedOrigins: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
  checks: { mongo: pingMongo, redis: () => pingRedis(redis) },
});

const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));

// Listen first so /api/health can report "down" while Mongo is still coming up.
connectMongo(env.MONGO_URL, logger).catch((err) => {
  logger.fatal({ err }, "could not connect to mongo");
  process.exit(1);
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([disconnectMongo(), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
