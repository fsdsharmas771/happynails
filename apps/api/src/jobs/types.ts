export type NotificationJob =
  | { type: "order_placed"; orderId: string }
  | { type: "order_shipped"; orderId: string }
  | { type: "booking_confirmed"; bookingId: string }
  | { type: "booking_reminder"; bookingId: string }
  | { type: "booking_cancelled"; bookingId: string };

/** Background work the request handlers hand off. BullMQ in the app, a recorder in tests. */
export interface Jobs {
  notify(job: NotificationJob): Promise<void>;
  /** Cancels the order and releases its stock if it is still unpaid when the delay passes. */
  scheduleOrderExpiry(orderId: string, delayMs: number): Promise<void>;
}
