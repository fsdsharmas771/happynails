import { addIstDays, formatINR, formatIstTime, istDateOf, istTimeOf, istToUtc } from "@happynails/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import { Booking } from "../models/Booking";
import { Order } from "../models/Order";
import { cancelUnpaidBooking } from "../bookings/engine";
import { cancelUnpaid } from "../orders/service";
import { buildMessage, toWhatsAppNumber, type WhatsAppMessage } from "../config/whatsapp";
import type { Notifier } from "./notifier";
import type { Jobs, NotificationJob } from "./types";

type MaintenanceJob =
  | { type: "expire_order"; orderId: string }
  | { type: "expire_booking"; bookingId: string }
  | { type: "booking_reminders" };

const ATTEMPTS = { attempts: 5, backoff: { type: "exponential", delay: 5000 } } as const;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const visitDay = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
});
/** "Sat 4 Oct, 10:00 am" in India time. */
const visitWhen = (d: Date) => {
  const p = Object.fromEntries(visitDay.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${formatIstTime(istTimeOf(d))}`;
};

/** The WhatsApp template and parameters for one notification, or null if its record is gone. */
export async function messageFor(
  job: NotificationJob,
): Promise<{ to: string; message: WhatsAppMessage } | null> {
  if (job.type === "order_placed" || job.type === "order_shipped") {
    const order = await Order.findById(job.orderId).lean();
    if (!order) return null;
    const first = firstName(order.customer.name);
    const message =
      job.type === "order_placed"
        ? buildMessage("order_placed", [first, order.number, formatINR(order.totalPaise)])
        : buildMessage("order_shipped", [
            first,
            order.number,
            order.tracking?.carrier || "our courier",
            order.tracking?.url || `awb ${order.tracking?.awb ?? ""}`,
          ]);
    return { to: toWhatsAppNumber(order.customer.phone), message };
  }

  const booking = await Booking.findById(job.bookingId).lean();
  if (!booking) return null;
  const first = firstName(booking.customer.name);
  const when = visitWhen(booking.startsAt);
  const payNote =
    booking.payment.status === "captured"
      ? "Paid online, nothing to pay at the visit."
      : "Pay after your visit by UPI or cash.";
  const message =
    job.type === "booking_confirmed"
      ? buildMessage("booking_confirmed", [first, booking.number, when, booking.city, payNote])
      : job.type === "booking_reminder"
        ? buildMessage("booking_reminder", [first, when])
        : buildMessage("booking_cancelled", [first, booking.number, when]);
  return { to: toWhatsAppNumber(booking.customer.phone), message };
}

async function sendNotification(job: NotificationJob, notifier: Notifier): Promise<void> {
  const m = await messageFor(job);
  if (m) await notifier.sendWhatsApp(m.to, m.message);
}

/**
 * Queues a reminder for every confirmed visit tomorrow (India time) that has not had one.
 * Claiming each booking with reminderSentAt makes reruns of the job safe.
 */
export async function queueBookingReminders(jobs: Pick<Jobs, "notify">, now = new Date()): Promise<number> {
  const tomorrow = addIstDays(istDateOf(now), 1);
  const from = istToUtc(tomorrow, "00:00");
  const to = istToUtc(addIstDays(tomorrow, 1), "00:00");
  let count = 0;
  for (;;) {
    const b = await Booking.findOneAndUpdate(
      { status: "confirmed", startsAt: { $gte: from, $lt: to }, reminderSentAt: { $exists: false } },
      { $set: { reminderSentAt: now } },
      { new: true },
    ).lean();
    if (!b) return count;
    await jobs.notify({ type: "booking_reminder", bookingId: String(b._id) });
    count++;
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

  const jobs: Jobs = {
    async notify(job) {
      await notifications.add(job.type, job, { ...ATTEMPTS, removeOnComplete: 1000, removeOnFail: 5000 });
    },
    async scheduleBookingExpiry(bookingId, delayMs) {
      await maintenance.add(
        "expire_booking",
        { type: "expire_booking", bookingId },
        {
          ...ATTEMPTS,
          delay: delayMs,
          jobId: `expire-booking-${bookingId}`,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
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
  };

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
        } else if (job.data.type === "expire_booking") {
          const cancelled = await cancelUnpaidBooking(job.data.bookingId, "Payment not completed in time");
          if (cancelled) log.info({ bookingId: job.data.bookingId }, "unpaid booking expired");
        } else {
          const n = await queueBookingReminders(jobs);
          log.info({ reminders: n }, "booking reminders queued");
        }
      },
      { connection: connection() },
    ),
  ];
  for (const w of workers) {
    w.on("failed", (job, err) => log.error({ err, queue: w.name, jobId: job?.id }, "job failed"));
  }

  // Evening-before reminders: every day at 18:00 India time.
  void maintenance
    .upsertJobScheduler(
      "booking-reminders",
      { pattern: "0 18 * * *", tz: "Asia/Kolkata" },
      { name: "booking_reminders", data: { type: "booking_reminders" } },
    )
    .catch((err) => log.error({ err }, "could not schedule booking reminders"));

  return {
    ...jobs,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([notifications.close(), maintenance.close()]);
    },
  };
}
