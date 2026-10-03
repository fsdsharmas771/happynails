import {
  createOrderRequestSchema,
  orderAccessSchema,
  quoteRequestSchema,
  verifyPaymentRequestSchema,
  type PaymentMethod,
} from "@happynails/shared";
import express, { Router } from "express";
import { HttpError } from "../errors";
import { Order } from "../models/Order";
import { priceCart, toQuoteResponse } from "../orders/pricing";
import {
  applyRazorpayEvent,
  createOrder,
  findByAccess,
  resumePayment,
  toTrackedOrder,
  type OrderDeps,
  type RazorpayEvent,
} from "../orders/service";

export function paymentMethods(deps: Pick<OrderDeps, "gateway">): PaymentMethod[] {
  return deps.gateway ? ["razorpay", "cod"] : ["cod"];
}

export function checkoutRouter(deps: Pick<OrderDeps, "gateway">): Router {
  const router = Router();
  router.post("/quote", async (req, res) => {
    const q = quoteRequestSchema.parse(req.body);
    const cart = await priceCart(q.items, q.shippingSpeed, q.paymentMethod);
    res.json(toQuoteResponse(cart, paymentMethods(deps)));
  });
  return router;
}

export function ordersRouter(deps: OrderDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const input = createOrderRequestSchema.parse(req.body);
    res.status(201).json(await createOrder(input, deps));
  });

  router.get("/track", async (req, res) => {
    const access = orderAccessSchema.safeParse(req.query);
    if (!access.success) throw new HttpError(404, "ORDER_NOT_FOUND", "We could not find that order");
    res.set("Cache-Control", "no-store");
    res.json(toTrackedOrder(await findByAccess(access.data)));
  });

  router.post("/pay", async (req, res) => {
    res.json(await resumePayment(orderAccessSchema.parse(req.body), deps.gateway));
  });

  return router;
}

export function paymentsRouter(deps: Pick<OrderDeps, "gateway">): Router {
  const router = Router();

  /**
   * Checkout's success callback. A valid signature lets the page say "payment received",
   * but the order is only marked paid by the webhook.
   */
  router.post("/razorpay/verify", async (req, res) => {
    const body = verifyPaymentRequestSchema.parse(req.body);
    if (!deps.gateway) throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Online payment is not available");
    const order = await Order.findOne({ number: body.orderNumber }).lean();
    const valid =
      !!order &&
      order.payment.razorpayOrderId === body.razorpay_order_id &&
      deps.gateway.verifyPaymentSignature(
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
      );
    if (!valid) throw new HttpError(400, "SIGNATURE_INVALID", "Payment could not be verified");
    res.json({ verified: true, status: order.status });
  });

  return router;
}

/** Must be mounted before express.json(): the signature covers the exact raw bytes. */
export function webhooksRouter(deps: OrderDeps): Router {
  const router = Router();

  router.post("/razorpay", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    if (!deps.gateway) throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Payments are not configured");
    const signature = req.get("x-razorpay-signature") ?? "";
    const eventId = req.get("x-razorpay-event-id") ?? "";
    const raw: unknown = req.body;
    if (!Buffer.isBuffer(raw) || !deps.gateway.verifyWebhookSignature(raw, signature)) {
      throw new HttpError(400, "SIGNATURE_INVALID", "Webhook signature mismatch");
    }
    if (!/^[\w-]{1,100}$/.test(eventId)) throw new HttpError(400, "EVENT_ID_MISSING", "Missing event id");

    let evt: RazorpayEvent;
    try {
      evt = JSON.parse(raw.toString("utf8")) as RazorpayEvent;
    } catch {
      throw new HttpError(400, "BAD_REQUEST", "Webhook body is not JSON");
    }

    const outcome = await applyRazorpayEvent(eventId, evt, deps);
    // Only ids and outcomes are logged; payloads carry customer contact details.
    req.log.info({ eventId, event: evt.event, outcome }, "razorpay webhook");
    res.json({ ok: true, outcome });
  });

  return router;
}
