import { createApp } from "./app";
import { connectMongo, disconnectMongo, pingMongo } from "./db/mongo";
import { createRedis, pingRedis } from "./db/redis";
import { loadEnv } from "./env";
import { createLogNotifier } from "./jobs/notifier";
import { startQueues } from "./jobs/queues";
import { createLogger } from "./logger";
import { createRazorpayGateway } from "./payments/gateway";

const env = loadEnv();
const logger = createLogger(env);
const redis = createRedis(env.REDIS_URL, logger);

const gateway =
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
    ? createRazorpayGateway({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
      })
    : null;
if (!gateway) logger.warn("Razorpay keys not set: online payment disabled, so checkout cannot complete");

// Real WhatsApp and email providers arrive behind env flags later; until then messages are logged.
const jobs = startQueues(env.REDIS_URL, createLogNotifier(logger), logger);

const app = createApp({
  logger,
  allowedOrigins: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
  checks: { mongo: pingMongo, redis: () => pingRedis(redis) },
  orders: { gateway, jobs, log: logger },
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
  await Promise.allSettled([jobs.close(), disconnectMongo(), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
