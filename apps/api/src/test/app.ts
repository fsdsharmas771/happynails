import { createHmac } from "node:crypto";
import { Redis } from "ioredis";
import { pino } from "pino";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../app";
import { createLocalUploadProvider } from "../uploads/provider";
import type { Jobs, NotificationJob } from "../jobs/types";
import { createRazorpayGateway, type GatewayOrder, type PaymentGateway } from "../payments/gateway";

export const TEST_ADMIN_SECRET = "test-admin-secret-that-is-long-enough-123";
export const TEST_UPLOAD_DIR = path.join(tmpdir(), "hn-test-uploads");

export const TEST_RAZORPAY = {
  keyId: "rzp_test_dummy",
  keySecret: "test_key_secret",
  webhookSecret: "test_webhook_secret",
};

export interface FakeJobs extends Jobs {
  notified: NotificationJob[];
  expiries: { orderId: string; delayMs: number }[];
  bookingExpiries: { bookingId: string; delayMs: number }[];
}

export function fakeJobs(): FakeJobs {
  const notified: NotificationJob[] = [];
  const expiries: { orderId: string; delayMs: number }[] = [];
  const bookingExpiries: { bookingId: string; delayMs: number }[] = [];
  return {
    notified,
    expiries,
    bookingExpiries,
    async notify(job) {
      notified.push(job);
    },
    async scheduleOrderExpiry(orderId, delayMs) {
      expiries.push({ orderId, delayMs });
    },
    async scheduleBookingExpiry(bookingId, delayMs) {
      bookingExpiries.push({ bookingId, delayMs });
    },
  };
}

/** Razorpay gateway with the real signature checks and a fake orders API. */
export function fakeGateway(opts: { fail?: boolean } = {}) {
  const created: { amount: number; receipt: string; notes: Record<string, string> }[] = [];
  const refunds: { paymentId: string; amount: number }[] = [];
  let n = 0;
  const gateway = createRazorpayGateway(TEST_RAZORPAY, {
    payments: {
      async refund(paymentId, input) {
        if (opts.fail) throw new Error("gateway down");
        refunds.push({ paymentId, amount: input.amount });
        return { id: `rfnd_test${refunds.length}`, amount: input.amount, status: "processed" };
      },
    },
    orders: {
      async create(input): Promise<GatewayOrder> {
        if (opts.fail) throw new Error("gateway down");
        created.push(input);
        return { id: `order_test${++n}`, amount: input.amount, currency: "INR" };
      },
    },
  });
  return { gateway, created, refunds };
}

export interface TestAppOptions {
  gateway?: PaymentGateway | null;
  jobs?: Jobs;
  redis?: Redis;
  keyPrefix?: string;
  now?: () => Date;
  siteUrl?: string;
}

// Never connects: for tests that do not touch booking routes.
const idleRedis = () => new Redis({ lazyConnect: true });

export function testApp(opts: TestAppOptions = {}) {
  const logger = pino({ level: "silent" });
  const jobs = opts.jobs ?? fakeJobs();
  const gateway = opts.gateway === undefined ? fakeGateway().gateway : opts.gateway;
  return createApp({
    logger,
    allowedOrigins: ["http://localhost:5173"],
    checks: { mongo: async () => true, redis: async () => true },
    orders: {
      gateway,
      jobs,
      log: logger,
    },
    bookings: {
      redis: opts.redis ?? idleRedis(),
      gateway,
      jobs,
      log: logger,
      ...(opts.keyPrefix ? { keyPrefix: opts.keyPrefix } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    },
    admin: {
      auth: { jwtSecret: TEST_ADMIN_SECRET, secureCookies: false },
      uploads: createLocalUploadProvider(TEST_UPLOAD_DIR),
      uploadDir: TEST_UPLOAD_DIR,
    },
    siteUrl: opts.siteUrl,
  });
}

export const signWebhook = (body: string) =>
  createHmac("sha256", TEST_RAZORPAY.webhookSecret).update(body).digest("hex");

export const signPayment = (orderId: string, paymentId: string) =>
  createHmac("sha256", TEST_RAZORPAY.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
