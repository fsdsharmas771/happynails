import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  deliveryEstimate,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type OrderAccess,
  type TrackedOrder,
} from "@happynails/shared";
import mongoose, { type ClientSession } from "mongoose";
import type { Logger } from "pino";
import { PAYMENT_TIMEOUT_MS } from "../config/checkout";
import { HttpError } from "../errors";
import type { Jobs } from "../jobs/types";
import { Counter, Order, ProcessedWebhook, type OrderDoc } from "../models/Order";
import { Product } from "../models/Product";
import type { PaymentGateway } from "../payments/gateway";
import { priceCart } from "./pricing";

export interface OrderDeps {
  gateway: PaymentGateway | null;
  jobs: Jobs;
  log: Logger;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** HN + two-digit year (India time) + a sequence, e.g. HN260001. Gaps are fine; uniqueness is what matters. */
export async function nextOrderNumber(now = new Date()): Promise<string> {
  const yy = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", year: "2-digit" }).format(now);
  const c = await Counter.findOneAndUpdate(
    { _id: `order-${yy}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return `HN${yy}${String(c!.seq).padStart(4, "0")}`;
}

function qtyByProduct(lines: { productId: unknown; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(String(l.productId), (m.get(String(l.productId)) ?? 0) + l.qty);
  return m;
}

/** Takes stock for every product or none; throws 409 inside the transaction so it aborts. */
async function takeStock(
  lines: { productId: unknown; qty: number }[],
  session: ClientSession,
): Promise<void> {
  for (const [productId, qty] of qtyByProduct(lines)) {
    const res = await Product.updateOne(
      { _id: productId, active: true, stock: { $gte: qty } },
      { $inc: { stock: -qty } },
      { session },
    );
    if (res.modifiedCount !== 1) throw new HttpError(409, "OUT_OF_STOCK", "A set in your bag just sold out");
  }
}

async function returnStock(order: OrderDoc, session: ClientSession): Promise<void> {
  for (const [productId, qty] of qtyByProduct(order.items)) {
    await Product.updateOne({ _id: productId }, { $inc: { stock: qty } }, { session });
  }
}

function checkoutFor(order: OrderDoc, gateway: PaymentGateway) {
  return {
    keyId: gateway.keyId,
    orderId: order.payment.razorpayOrderId!,
    amount: order.totalPaise,
    currency: "INR" as const,
  };
}

export async function createOrder(input: CreateOrderRequest, deps: OrderDeps): Promise<CreateOrderResponse> {
  const { gateway, jobs, log } = deps;
  if (input.paymentMethod === "razorpay" && !gateway) {
    throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Online payment is not available right now");
  }

  const cart = await priceCart(input.items, input.shippingSpeed, input.paymentMethod);
  if (!cart.allAvailable) {
    throw new HttpError(409, "ITEMS_UNAVAILABLE", "Some sets in your bag are no longer available", {
      slugs: cart.lines.filter((l) => !l.available).map((l) => l.slug),
    });
  }

  const number = await nextOrderNumber();
  const trackToken = randomBytes(24).toString("base64url");
  const cod = input.paymentMethod === "cod";
  const now = new Date();
  const status = cod ? "placed" : "pending_payment";

  let order!: OrderDoc;
  await mongoose.connection.transaction(async (session) => {
    await takeStock(cart.lines, session);
    const created = await Order.create(
      [
        {
          number,
          customer: input.customer,
          address: input.address,
          items: cart.lines.map((l) => ({
            productId: l.productId,
            slug: l.slug,
            name: l.product!.name,
            optionKey: l.option,
            optionLabel: l.optionLabel,
            unitPaise: l.unitPaise,
            qty: l.qty,
          })),
          ...cart.totals,
          shippingSpeed: input.shippingSpeed,
          paymentMethod: input.paymentMethod,
          payment: { status: cod ? "cod" : "pending" },
          status,
          stockState: cod ? "committed" : "reserved",
          trackTokenHash: sha256(trackToken),
          deliveryDays: deliveryEstimate(input.address.pincode)?.standardDays,
          events: [{ status, at: now }],
        },
      ],
      { session },
    );
    order = created[0]!;
  });

  if (cod) {
    await jobs.notify({ type: "order_placed", orderId: order.id }).catch((err) => {
      log.error({ err, order: number }, "could not enqueue order notification");
    });
    return { orderNumber: number, trackToken, status: "placed", totalPaise: order.totalPaise };
  }

  try {
    const rzp = await gateway!.createOrder({
      amountPaise: order.totalPaise,
      receipt: number,
      notes: { orderId: order.id, orderNumber: number },
    });
    order.payment.razorpayOrderId = rzp.id;
    await order.save();
  } catch (err) {
    log.error({ err, order: number }, "razorpay order create failed; releasing stock");
    await cancelUnpaid(order.id, "Payment gateway unavailable");
    throw new HttpError(502, "PAYMENT_GATEWAY_ERROR", "Could not start the payment. Please try again.");
  }

  await jobs.scheduleOrderExpiry(order.id, PAYMENT_TIMEOUT_MS).catch((err) => {
    log.error({ err, order: number }, "could not schedule order expiry");
  });

  return {
    orderNumber: number,
    trackToken,
    status: "pending_payment",
    totalPaise: order.totalPaise,
    razorpay: checkoutFor(order, gateway!),
  };
}

/** Cancels an order that is still awaiting payment and returns its stock. No-op otherwise. */
export async function cancelUnpaid(orderId: string, note: string): Promise<boolean> {
  let cancelled = false;
  await mongoose.connection.transaction(async (session) => {
    const order = await Order.findOne({ _id: orderId, status: "pending_payment" }).session(session);
    if (!order) return;
    if (order.stockState === "reserved") await returnStock(order, session);
    order.status = "cancelled";
    order.stockState = "released";
    order.events.push({ status: "cancelled", at: new Date(), note });
    await order.save({ session });
    cancelled = true;
  });
  return cancelled;
}

export async function findByAccess({ number, token }: OrderAccess): Promise<OrderDoc> {
  const order = await Order.findOne({ number });
  const ok =
    !!order && timingSafeEqual(Buffer.from(order.trackTokenHash, "hex"), Buffer.from(sha256(token), "hex"));
  // Same response for a wrong number and a wrong token, so numbers cannot be probed.
  if (!order || !ok) throw new HttpError(404, "ORDER_NOT_FOUND", "We could not find that order");
  return order;
}

/** Checkout details to retry payment on an order that is still unpaid. */
export async function resumePayment(access: OrderAccess, gateway: PaymentGateway | null) {
  const order = await findByAccess(access);
  if (order.status !== "pending_payment" || !order.payment.razorpayOrderId || !gateway) {
    throw new HttpError(409, "ORDER_NOT_PAYABLE", "This order is not awaiting payment");
  }
  return { orderNumber: order.number, razorpay: checkoutFor(order, gateway) };
}

export function toTrackedOrder(o: OrderDoc): TrackedOrder {
  return {
    number: o.number,
    status: o.status,
    firstName: o.customer.name.split(/\s+/)[0] ?? "",
    city: o.address.city,
    placedAt: o.createdAt.toISOString(),
    paymentMethod: o.paymentMethod,
    paymentStatus: o.payment.status,
    shippingSpeed: o.shippingSpeed,
    items: o.items.map((i) => ({
      name: i.name,
      optionLabel: i.optionLabel,
      qty: i.qty,
      linePaise: i.unitPaise * i.qty,
    })),
    totals: {
      subtotalPaise: o.subtotalPaise,
      shippingPaise: o.shippingPaise,
      codFeePaise: o.codFeePaise,
      totalPaise: o.totalPaise,
    },
    ...(o.tracking?.awb || o.tracking?.url
      ? {
          tracking: {
            ...(o.tracking.carrier ? { carrier: o.tracking.carrier } : {}),
            ...(o.tracking.awb ? { awb: o.tracking.awb } : {}),
            ...(o.tracking.url ? { url: o.tracking.url } : {}),
          },
        }
      : {}),
    events: o.events.map((e) => ({ status: e.status, at: e.at.toISOString() })),
    ...(o.deliveryDays?.length === 2 ? { deliveryDays: [o.deliveryDays[0]!, o.deliveryDays[1]!] } : {}),
  };
}

// ---------- Razorpay webhook ----------

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  error_description?: string;
}

export interface RazorpayEvent {
  event: string;
  payload: { payment?: { entity: RazorpayPaymentEntity } };
}

export type WebhookOutcome =
  | "duplicate"
  | "ignored"
  | "unknown_order"
  | "amount_mismatch"
  | "placed"
  | "already_final"
  | "payment_failed";

/**
 * Applies one verified webhook event. The event id is recorded in the same transaction as the
 * order change, so a replayed or concurrent duplicate can never apply twice.
 */
export async function applyRazorpayEvent(
  eventId: string,
  evt: RazorpayEvent,
  deps: Pick<OrderDeps, "jobs" | "log">,
): Promise<WebhookOutcome> {
  const payment = evt.payload.payment?.entity;
  const handled = ["payment.captured", "order.paid", "payment.failed"];

  let outcome = "ignored" as WebhookOutcome;
  let placedOrderId: string | null = null;

  try {
    await mongoose.connection.transaction(async (session) => {
      outcome = "ignored";
      placedOrderId = null;
      if (handled.includes(evt.event) && payment) {
        const order = await Order.findOne({ "payment.razorpayOrderId": payment.order_id }).session(session);
        if (!order) outcome = "unknown_order";
        else if (evt.event === "payment.failed") outcome = await recordFailure(order, payment, session);
        else if (payment.amount !== order.totalPaise) outcome = "amount_mismatch";
        else {
          outcome = await markPaid(order, payment, session);
          if (outcome === "placed") placedOrderId = order.id;
        }
      }
      await ProcessedWebhook.create([{ _id: eventId, event: evt.event, outcome }], { session });
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return "duplicate";
    throw err;
  }

  if (outcome === "amount_mismatch" || outcome === "unknown_order") {
    deps.log.warn({ eventId, event: evt.event, outcome }, "razorpay event not applied");
  }
  if (placedOrderId) {
    await deps.jobs.notify({ type: "order_placed", orderId: placedOrderId }).catch((err) => {
      deps.log.error({ err, eventId }, "could not enqueue order notification");
    });
  }
  return outcome;
}

async function markPaid(
  order: OrderDoc,
  payment: RazorpayPaymentEntity,
  session: ClientSession,
): Promise<WebhookOutcome> {
  if (order.payment.status === "captured") return "already_final";
  const now = new Date();
  let note: string | undefined;

  if (order.stockState === "released") {
    // Paid after the 30 minute hold lapsed. Take the stock again; if it has gone, still honour the
    // payment but flag the order for the owner rather than refusing money already taken.
    try {
      await takeStock(order.items, session);
      note = "Paid after the payment window closed; stock re-reserved";
    } catch {
      for (const [productId, qty] of qtyByProduct(order.items)) {
        await Product.updateOne({ _id: productId }, { $inc: { stock: -qty } }, { session });
      }
      note = "Paid after the payment window closed; stock was short, check inventory";
    }
  }

  order.payment.status = "captured";
  order.payment.razorpayPaymentId = payment.id;
  order.payment.paidAt = now;
  order.payment.failureReason = undefined;
  order.stockState = "committed";
  if (order.status === "pending_payment" || order.status === "cancelled") {
    order.status = "placed";
    order.events.push({ status: "placed", at: now, ...(note ? { note } : {}) });
  }
  await order.save({ session });
  return "placed";
}

async function recordFailure(
  order: OrderDoc,
  payment: RazorpayPaymentEntity,
  session: ClientSession,
): Promise<WebhookOutcome> {
  // A later successful attempt wins; a failure never overrides a capture.
  if (order.payment.status === "captured") return "already_final";
  order.payment.status = "failed";
  order.payment.failureReason = payment.error_description?.slice(0, 200);
  await order.save({ session });
  return "payment_failed";
}
