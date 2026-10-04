import { createApp } from "./app";
import { connectMongo, disconnectMongo, pingMongo } from "./db/mongo";
import { createRedis, pingRedis } from "./db/redis";
import { loadEnv } from "./env";
import { createLogNotifier, createWhatsAppCloudNotifier } from "./jobs/notifier";
import { startQueues } from "./jobs/queues";
import { createLogger } from "./logger";
import { createRazorpayGateway } from "./payments/gateway";
import { createLocalUploadProvider } from "./uploads/provider";

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

// WhatsApp Cloud API when configured; otherwise messages are logged (development).
const notifier =
  env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
    ? createWhatsAppCloudNotifier(
        {
          accessToken: env.WHATSAPP_ACCESS_TOKEN,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          apiVersion: env.WHATSAPP_API_VERSION,
          language: env.WHATSAPP_TEMPLATE_LANGUAGE,
        },
        logger,
      )
    : createLogNotifier(logger);
if (!env.WHATSAPP_ACCESS_TOKEN)
  logger.warn("WhatsApp not configured: customer messages are logged, not sent");
const jobs = startQueues(env.REDIS_URL, notifier, logger);

const app = createApp({
  logger,
  allowedOrigins: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
  checks: { mongo: pingMongo, redis: () => pingRedis(redis) },
  orders: { gateway, jobs, log: logger },
  bookings: { redis, gateway, jobs, log: logger },
  admin: {
    auth: { jwtSecret: env.ADMIN_JWT_SECRET, secureCookies: env.NODE_ENV === "production" },
    uploads: createLocalUploadProvider(env.UPLOAD_DIR),
    uploadDir: env.UPLOAD_DIR,
  },
  siteUrl: env.PUBLIC_SITE_URL,
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
