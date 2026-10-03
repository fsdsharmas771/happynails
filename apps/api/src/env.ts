import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONGO_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.url(),
  ADMIN_ORIGIN: z.url(),
  // Razorpay (test keys locally). All three or none: without them only cash on delivery is offered.
  RAZORPAY_KEY_ID: z
    .string()
    .regex(/^rzp_(test|live)_\w+$/)
    .optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
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
