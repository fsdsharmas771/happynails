import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONGO_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.url(),
  ADMIN_ORIGIN: z.url(),
  // Razorpay (test keys locally). All three or none: without them checkout cannot take payment.
  RAZORPAY_KEY_ID: z
    .string()
    .regex(/^rzp_(test|live)_\w+$/)
    .optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  ADMIN_JWT_SECRET: z.string().min(32, "ADMIN_JWT_SECRET must be at least 32 characters"),
  /** Seed only: the first owner account. */
  ADMIN_OWNER_EMAIL: z.email().optional(),
  ADMIN_OWNER_PASSWORD: z.string().min(10).optional(),
  /** Proxies in front of the API: 1 behind nginx, 2 if a CDN such as Cloudflare sits in front of nginx. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  UPLOAD_DIR: z.string().default("/app/uploads"),
  /** The storefront's public address, e.g. https://www.example.in. Needed for the sitemap. */
  PUBLIC_SITE_URL: z.url().optional(),
  // Meta WhatsApp Cloud API. Without a token and phone number id, messages are only logged.
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v23.0"),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),
  // Shiprocket API user. Email, password and pickup location together, or none.
  SHIPROCKET_EMAIL: z.email().optional(),
  SHIPROCKET_PASSWORD: z.string().min(1).optional(),
  SHIPROCKET_PICKUP_LOCATION: z.string().min(1).optional(),
  /** Shared secret Shiprocket sends as x-api-key on tracking webhooks. */
  SHIPROCKET_WEBHOOK_TOKEN: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const rzp = [
    parsed.data.RAZORPAY_KEY_ID,
    parsed.data.RAZORPAY_KEY_SECRET,
    parsed.data.RAZORPAY_WEBHOOK_SECRET,
  ];
  if (rzp.some(Boolean) && !rzp.every(Boolean)) {
    throw new Error(
      "Invalid environment: set all of RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET, or none",
    );
  }
  return parsed.data;
}
