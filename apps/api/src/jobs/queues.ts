import { formatINR } from "@happynails/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import { Order } from "../models/Order";
import { cancelUnpaid } from "../orders/service";
import type { Notifier } from "./notifier";
import type { Jobs, NotificationJob } from "./types";

type MaintenanceJob = { type: "expire_order"; orderId: string };

const ATTEMPTS = { attempts: 5, backoff: { type: "exponential", delay: 5000 } } as const;

async function sendNotification(job: NotificationJob, notifier: Notifier): Promise<void> {
  const order = await Order.findById(job.orderId).lean();
  if (!order) return;
  const first = order.customer.name.split(/\s+/)[0];
  if (job.type === "order_placed") {
    const msg = `Hi ${first}, your Happy Nails order ${order.number} (${formatINR(order.totalPaise)}) is placed. We will message you when it ships.`;
    await notifier.sendWhatsApp(order.customer.phone, msg);
    await notifier.sendEmail(order.customer.email, `Order ${order.number} placed`, msg);
  } else {
    const link = order.tracking?.url ? ` Track it here: ${order.tracking.url}` : "";
    const msg = `Hi ${first}, your Happy Nails order ${order.number} has shipped.${link}`;
    await notifier.sendWhatsApp(order.customer.phone, msg);
    await notifier.sendEmail(order.customer.email, `Order ${order.number} shipped`, msg);
  }
}

/** BullMQ-backed jobs plus their workers, running in the API process. */
export function startQueues(
  redisUrl: string,
  notifier: Notifier,
  log: Logger,
): Jobs & { close(): Promise<void> } {
  // BullMQ needs its own connections with maxRetriesPerRequest disabled.
  const connection = () => new Redis(redisUrl, { maxRetriesPerRequest: null });

  const notifications = new Queue<NotificationJob>("notifications", { connection: connection() });
  const maintenance = new Queue<MaintenanceJob>("maintenance", { connection: connection() });

  const workers = [
    new Worker<NotificationJob>("notifications", (job) => sendNotification(job.data, notifier), {
      connection: connection(),
    }),
    new Worker<MaintenanceJob>(
      "maintenance",
      async (job) => {
        if (job.data.type === "expire_order") {
          const cancelled = await cancelUnpaid(job.data.orderId, "Payment not completed in time");
          if (cancelled) log.info({ orderId: job.data.orderId }, "unpaid order expired");
        }
      },
      { connection: connection() },
    ),
  ];
  for (const w of workers)
    w.on("failed", (job, err) => log.error({ err, queue: w.name, jobId: job?.id }, "job failed"));

  return {
    async notify(job) {
      await notifications.add(job.type, job, { ...ATTEMPTS, removeOnComplete: 1000, removeOnFail: 5000 });
    },
    async scheduleOrderExpiry(orderId, delayMs) {
      await maintenance.add(
        "expire_order",
        { type: "expire_order", orderId },
        {
          ...ATTEMPTS,
          delay: delayMs,
          jobId: `expire-${orderId}`,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    },
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([notifications.close(), maintenance.close()]);
    },
  };
}
