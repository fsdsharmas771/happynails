import { createHmac } from "node:crypto";
import { Redis } from "ioredis";
import { pino } from "pino";
import { createApp } from "../app";
import type { Jobs, NotificationJob } from "../jobs/types";
import { createRazorpayGateway, type GatewayOrder, type PaymentGateway } from "../payments/gateway";

export const TEST_RAZORPAY = {
  keyId: "rzp_test_dummy",
  keySecret: "test_key_secret",
  webhookSecret: "test_webhook_secret",
};

export interface FakeJobs extends Jobs {
  notified: NotificationJob[];
  expiries: { orderId: string; delayMs: number }[];
}

export function fakeJobs(): FakeJobs {
  const notified: NotificationJob[] = [];
  const expiries: { orderId: string; delayMs: number }[] = [];
  return {
    notified,
    expiries,
    async notify(job) {
      notified.push(job);
    },
    async scheduleOrderExpiry(orderId, delayMs) {
      expiries.push({ orderId, delayMs });
    },
  };
}

/** Razorpay gateway with the real signature checks and a fake orders API. */
export function fakeGateway(opts: { fail?: boolean } = {}) {
  const created: { amount: number; receipt: string; notes: Record<string, string> }[] = [];
  let n = 0;
  const gateway = createRazorpayGateway(TEST_RAZORPAY, {
    orders: {
      async create(input): Promise<GatewayOrder> {
        if (opts.fail) throw new Error("gateway down");
        created.push(input);
        return { id: `order_test${++n}`, amount: input.amount, currency: "INR" };
      },
    },
  });
  return { gateway, created };
}

export interface TestAppOptions {
  gateway?: PaymentGateway | null;
  jobs?: Jobs;
  redis?: Redis;
  keyPrefix?: string;
  now?: () => Date;
}

// Never connects: for tests that do not touch booking routes.
const idleRedis = () => new Redis({ lazyConnect: true });

export function testApp(opts: TestAppOptions = {}) {
  const logger = pino({ level: "silent" });
  const jobs = opts.jobs ?? fakeJobs();
  return createApp({
    logger,
    allowedOrigins: ["http://localhost:5173"],
    checks: { mongo: async () => true, redis: async () => true },
    orders: {
      gateway: opts.gateway === undefined ? fakeGateway().gateway : opts.gateway,
      jobs,
      log: logger,
    },
    bookings: {
      redis: opts.redis ?? idleRedis(),
      jobs,
      log: logger,
      ...(opts.keyPrefix ? { keyPrefix: opts.keyPrefix } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    },
  });
}

export const signWebhook = (body: string) =>
  createHmac("sha256", TEST_RAZORPAY.webhookSecret).update(body).digest("hex");

export const signPayment = (orderId: string, paymentId: string) =>
  createHmac("sha256", TEST_RAZORPAY.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
