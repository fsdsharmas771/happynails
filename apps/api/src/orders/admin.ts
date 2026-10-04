import type { OrderStatus } from "@happynails/shared";
import mongoose from "mongoose";
import { HttpError } from "../errors";
import { issueCreditNote } from "../invoices/service";
import { Order, type OrderDoc } from "../models/Order";
import { Product } from "../models/Product";
import { orderStepForCourierStatus, ShiprocketError, type ShippingProvider } from "../shipping/shiprocket";
import type { OrderDeps } from "./service";

/** Forward moves the team can make by hand. Payment, expiry and refunds move orders elsewhere. */
const NEXT: Partial<Record<OrderStatus, OrderStatus[]>> = {
  placed: ["packed"],
  packed: ["shipped"],
  shipped: ["delivered"],
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listOrders(q: {
  status?: OrderStatus | undefined;
  q?: string | undefined;
  page: number;
}) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.q) {
    const re = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [
      { number: re },
      { "customer.name": re },
      { "customer.phone": re },
      { "customer.email": re },
    ];
  }
  const limit = 25;
  const [items, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * limit)
      .limit(limit)
      .select({
        number: 1,
        status: 1,
        customer: 1,
        "address.city": 1,
        totalPaise: 1,
        payment: 1,
        createdAt: 1,
      })
      .lean(),
    Order.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / limit)) };
}

async function load(id: string): Promise<OrderDoc> {
  const order = mongoose.isValidObjectId(id) ? await Order.findById(id) : null;
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "No such order");
  return order;
}

export const getOrder = load;

export async function changeOrderStatus(
  id: string,
  status: OrderStatus,
  by: string,
  deps: OrderDeps,
  note?: string,
) {
  const order = await load(id);
  if (!NEXT[order.status]?.includes(status)) {
    throw new HttpError(409, "BAD_TRANSITION", `An order that is ${order.status} cannot become ${status}`);
  }
  if (status === "shipped" && !order.tracking?.awb) {
    throw new HttpError(
      409,
      "TRACKING_REQUIRED",
      "Add the courier and tracking number before marking shipped",
    );
  }
  order.status = status;
  order.events.push({ status, at: new Date(), note: note ? `${note} (${by})` : `By ${by}` });
  await order.save();
  if (status === "shipped") {
    await deps.jobs.notify({ type: "order_shipped", orderId: order.id }).catch((err) => {
      deps.log.error({ err, order: order.number }, "could not enqueue shipped notification");
    });
  }
  return order;
}

export async function setTracking(
  id: string,
  tracking: { carrier: string; awb: string; url?: string | undefined },
) {
  const order = await load(id);
  if (!["placed", "packed", "shipped"].includes(order.status)) {
    throw new HttpError(409, "BAD_TRANSITION", `Tracking cannot be set on an order that is ${order.status}`);
  }
  order.tracking = { carrier: tracking.carrier, awb: tracking.awb, url: tracking.url ?? "" };
  await order.save();
  return order;
}

/** Cancels an order that has not shipped and returns its stock. Paid orders then need a refund. */
export async function cancelOrder(id: string, note: string, by: string) {
  await mongoose.connection.transaction(async (session) => {
    const order = await Order.findById(id).session(session);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "No such order");
    if (!["pending_payment", "placed", "packed"].includes(order.status)) {
      throw new HttpError(409, "BAD_TRANSITION", `An order that is ${order.status} cannot be cancelled`);
    }
    if (order.stockState !== "released") {
      for (const i of order.items) {
        await Product.updateOne({ _id: i.productId }, { $inc: { stock: i.qty } }, { session });
      }
      order.stockState = "released";
    }
    order.status = "cancelled";
    order.events.push({ status: "cancelled", at: new Date(), note: `${note} (${by})` });
    await order.save({ session });
  });
  return load(id);
}

export async function refundOrder(
  id: string,
  input: { amountPaise?: number | undefined; reason: string },
  by: string,
  deps: OrderDeps,
) {
  const order = await load(id);
  if (!deps.gateway) throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Razorpay is not configured");
  if (order.payment.status !== "captured" || !order.payment.razorpayPaymentId) {
    throw new HttpError(409, "NOT_REFUNDABLE", "Only orders paid online can be refunded");
  }
  const refunded = order.refunds.reduce((s, r) => s + r.amountPaise, 0);
  const left = order.totalPaise - refunded;
  const amount = input.amountPaise ?? left;
  if (amount <= 0 || amount > left) {
    throw new HttpError(400, "BAD_AMOUNT", `You can refund up to ${left} paise on this order`);
  }
  const r = await deps.gateway.refund({
    paymentId: order.payment.razorpayPaymentId,
    amountPaise: amount,
    notes: { orderNumber: order.number, reason: input.reason.slice(0, 200) },
  });
  const now = new Date();
  order.refunds.push({ razorpayRefundId: r.id, amountPaise: r.amountPaise, reason: input.reason, at: now });
  const full = refunded + r.amountPaise >= order.totalPaise;
  if (full) {
    order.payment.status = "refunded";
    order.status = "refunded";
  }
  order.events.push({
    status: order.status,
    at: now,
    note: `${full ? "Refunded in full" : `Partly refunded ${r.amountPaise} paise`}: ${input.reason} (${by})`,
  });
  await order.save();
  await issueCreditNote(
    { type: "order", id: order.id },
    { razorpayRefundId: r.id, amountPaise: r.amountPaise, reason: input.reason, at: now },
  );
  return order;
}

/**
 * Books the courier through Shiprocket: creates the shipment, gets the AWB and tracking link,
 * and moves a placed order to packed. If Shiprocket created the shipment but could not assign a
 * courier, the shipment ids are kept so trying again only repeats the courier step.
 */
export async function shipWithShiprocket(id: string, provider: ShippingProvider | null, by: string) {
  if (!provider) throw new HttpError(503, "SHIPPING_UNAVAILABLE", "Shiprocket is not configured");
  const order = await load(id);
  if (!["placed", "packed"].includes(order.status)) {
    throw new HttpError(409, "BAD_TRANSITION", `An order that is ${order.status} cannot be shipped`);
  }
  if (order.tracking?.awb)
    throw new HttpError(409, "ALREADY_SHIPPING", `This order already has AWB ${order.tracking.awb}`);
  const existing =
    order.shiprocket?.orderId && order.shiprocket.shipmentId
      ? { srOrderId: order.shiprocket.orderId, shipmentId: order.shiprocket.shipmentId }
      : undefined;
  try {
    const r = await provider.ship(
      {
        orderNumber: order.number,
        orderDate: order.createdAt,
        customer: order.customer,
        address: order.address,
        items: order.items.map((i) => ({
          name: `${i.name} (${i.optionLabel})`,
          sku: `${i.slug}-${i.optionKey}`,
          qty: i.qty,
          unitPaise: i.unitPaise,
        })),
        shippingPaise: order.shippingPaise,
        totalPaise: order.totalPaise,
      },
      existing,
    );
    order.shiprocket = { orderId: r.srOrderId, shipmentId: r.shipmentId };
    order.tracking = { carrier: r.courierName ?? "", awb: r.awb ?? "", url: r.trackingUrl ?? "" };
    if (order.status === "placed") order.status = "packed";
    order.events.push({
      status: order.status,
      at: new Date(),
      note: `Shiprocket: ${r.courierName} AWB ${r.awb} (${by})`,
    });
    await order.save();
    return order;
  } catch (err) {
    if (err instanceof ShiprocketError) {
      if (err.partial) {
        order.shiprocket = { orderId: err.partial.srOrderId, shipmentId: err.partial.shipmentId };
        await order.save();
      }
      throw new HttpError(502, "SHIPROCKET_ERROR", err.message);
    }
    throw err;
  }
}

/**
 * Applies a courier tracking update (Shiprocket webhook) to the order with that AWB.
 * Orders only ever move forward; the customer is told once, when the parcel ships.
 */
export async function applyCourierUpdate(awb: string, status: string, deps: OrderDeps): Promise<string> {
  const order = await Order.findOne({ "tracking.awb": awb });
  if (!order) return "unknown_awb";
  const step = orderStepForCourierStatus(status);
  const now = new Date();
  const note = `Courier: ${status}`;
  if (order.events.at(-1)?.note === note) return "unchanged";
  let notifyShipped = false;
  if (step && ["placed", "packed"].includes(order.status)) {
    order.status = "shipped";
    order.events.push({ status: "shipped", at: now, note });
    notifyShipped = true;
  }
  if (step === "delivered" && order.status === "shipped") {
    order.status = "delivered";
    order.events.push({ status: "delivered", at: now, note });
  } else if (!notifyShipped) {
    order.events.push({ status: order.status, at: now, note });
  }
  await order.save();
  if (notifyShipped) {
    await deps.jobs.notify({ type: "order_shipped", orderId: order.id }).catch((err) => {
      deps.log.error({ err, order: order.number }, "could not enqueue shipped notification");
    });
  }
  return order.status;
}
