import { createOrderResponseSchema, quoteResponseSchema, trackedOrderSchema } from "@happynails/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { Order, ProcessedWebhook } from "../models/Order";
import { Product } from "../models/Product";
import { cancelUnpaid } from "../orders/service";
import { seedProducts } from "../seed/seedProducts";
import { fakeGateway, fakeJobs, signPayment, signWebhook, testApp, type FakeJobs } from "../test/app";
import { useTestDb } from "../test/db";

useTestDb();

const customer = { name: "Riya Sharma", phone: "9876543210", email: "riya@example.com" };
const address = { line: "12 Park Street, Hauz Khas", pincode: "110016", city: "New Delhi", state: "Delhi" };
const rose = { slug: "rose-chrome", option: "standard", qty: 1 } as const; // 149900
const milk = { slug: "milk-bath", option: "standard", qty: 1 } as const; // 89900

let jobs: FakeJobs;
let gw: ReturnType<typeof fakeGateway>;
let app: ReturnType<typeof testApp>;

beforeEach(async () => {
  await seedProducts();
  jobs = fakeJobs();
  gw = fakeGateway();
  app = testApp({ gateway: gw.gateway, jobs });
});

const stockOf = async (slug: string) => (await Product.findOne({ slug }).lean())!.stock;

function placeOrder(body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/orders")
    .send({
      items: [rose],
      customer,
      address,
      shippingSpeed: "standard",
      paymentMethod: "razorpay",
      ...body,
    });
}

function webhook(event: string, payment: Record<string, unknown>, eventId: string) {
  const body = JSON.stringify({ entity: "event", event, payload: { payment: { entity: payment } } });
  return request(app)
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signWebhook(body))
    .set("x-razorpay-event-id", eventId)
    .send(body);
}

async function pendingOrder() {
  const res = await placeOrder();
  const created = createOrderResponseSchema.parse(res.body);
  return { ...created, rzpOrderId: created.razorpay!.orderId };
}

describe("POST /api/checkout/quote", () => {
  const quote = (body: Record<string, unknown>) => request(app).post("/api/checkout/quote").send(body);

  it("prices from the database and charges standard delivery under the threshold", async () => {
    const res = await quote({ items: [milk] });
    const q = quoteResponseSchema.parse(res.body);
    expect(q.totals).toEqual({
      subtotalPaise: 89900,
      shippingPaise: 7900,
      codFeePaise: 0,
      totalPaise: 97800,
    });
    expect(q.lines[0]).toMatchObject({ available: true, unitPaise: 89900, product: { name: "Milk Bath" } });
    expect(q.paymentMethods).toEqual(["razorpay", "cod"]);
  });

  it("gives free standard delivery at the threshold, charges express and COD", async () => {
    expect((await quote({ items: [rose] })).body.totals.shippingPaise).toBe(0);
    const q = (await quote({ items: [rose], shippingSpeed: "express", paymentMethod: "cod" })).body;
    expect(q.totals).toEqual({
      subtotalPaise: 149900,
      shippingPaise: 14900,
      codFeePaise: 4900,
      totalPaise: 169700,
    });
  });

  it("adds the custom-fit fee and merges duplicate lines", async () => {
    const q = (
      await quote({
        items: [
          { ...milk, option: "custom" },
          { ...milk, option: "custom", qty: 2 },
        ],
      })
    ).body;
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ qty: 3, unitPaise: 119900, linePaise: 359700 });
  });

  it("ignores prices sent by the client", async () => {
    const q = (await quote({ items: [{ ...milk, unitPaise: 1 }], totals: { totalPaise: 1 } })).body;
    expect(q.totals.subtotalPaise).toBe(89900);
  });

  it("flags unavailable lines and leaves them out of the totals", async () => {
    await Product.updateOne({ slug: "rose-chrome" }, { stock: 0 });
    await Product.updateOne({ slug: "pearl-veil" }, { active: false });
    const q = (
      await quote({
        items: [
          rose,
          milk,
          { slug: "pearl-veil", option: "standard", qty: 1 },
          { slug: "gone", option: "standard", qty: 1 },
        ],
      })
    ).body;
    expect(q.lines.map((l: { available: boolean }) => l.available)).toEqual([false, true, false, false]);
    expect(q.lines[3].product).toBeNull();
    expect(q.totals.subtotalPaise).toBe(89900);
    expect(q.allAvailable).toBe(false);
  });

  it("rejects an empty bag", async () => {
    expect((await quote({ items: [] })).status).toBe(400);
  });

  it("offers only COD without Razorpay keys", async () => {
    app = testApp({ gateway: null, jobs });
    expect((await quote({ items: [milk] })).body.paymentMethods).toEqual(["cod"]);
  });
});

describe("POST /api/orders", () => {
  it("places a COD order immediately, takes stock and notifies", async () => {
    const res = await placeOrder({ paymentMethod: "cod", items: [{ ...rose, qty: 2 }] });
    expect(res.status).toBe(201);
    const body = createOrderResponseSchema.parse(res.body);
    expect(body).toMatchObject({ status: "placed", totalPaise: 299800 + 4900 });
    expect(body.orderNumber).toMatch(/^HN\d{2}\d{4}$/);
    expect(body.razorpay).toBeUndefined();
    expect(await stockOf("rose-chrome")).toBe(18);
    expect(jobs.notified).toEqual([{ type: "order_placed", orderId: expect.any(String) }]);
    const order = await Order.findOne({ number: body.orderNumber }).lean();
    expect(order).toMatchObject({ stockState: "committed", payment: { status: "cod" } });
    expect(order!.trackTokenHash).not.toBe(body.trackToken);
  });

  it("creates a Razorpay order for the server total, reserves stock and schedules expiry", async () => {
    const res = await placeOrder({ items: [milk], shippingSpeed: "express" });
    expect(res.status).toBe(201);
    const body = createOrderResponseSchema.parse(res.body);
    expect(body.status).toBe("pending_payment");
    expect(body.razorpay).toEqual({
      keyId: "rzp_test_dummy",
      orderId: "order_test1",
      amount: 104800,
      currency: "INR",
    });
    expect(gw.created[0]).toMatchObject({ amount: 104800, receipt: body.orderNumber });
    expect(await stockOf("milk-bath")).toBe(19);
    expect(jobs.expiries).toEqual([{ orderId: expect.any(String), delayMs: 30 * 60 * 1000 }]);
    expect(jobs.notified).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("test_key_secret");
  });

  it("gives sequential order numbers", async () => {
    const a = (await placeOrder({ paymentMethod: "cod" })).body.orderNumber as string;
    const b = (await placeOrder({ paymentMethod: "cod" })).body.orderNumber as string;
    expect(Number(b.slice(-4))).toBe(Number(a.slice(-4)) + 1);
  });

  it("takes no stock at all when one set runs out mid-order", async () => {
    await Product.updateOne({ slug: "milk-bath" }, { stock: 1 });
    // Quote sees enough stock, then a parallel buyer takes the last one before our transaction.
    const [a, b] = await Promise.all([
      placeOrder({ paymentMethod: "cod", items: [rose, milk] }),
      placeOrder({ paymentMethod: "cod", items: [milk] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await stockOf("milk-bath")).toBe(0);
    const roseLeft = await stockOf("rose-chrome");
    expect(roseLeft).toBe(a.status === 201 ? 19 : 20);
    expect(await Order.countDocuments()).toBe(1);
  });

  it("refuses unavailable sets with 409", async () => {
    await Product.updateOne({ slug: "rose-chrome" }, { stock: 0 });
    const res = await placeOrder();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "ITEMS_UNAVAILABLE", details: { slugs: ["rose-chrome"] } });
  });

  it("validates customer and address", async () => {
    const res = await placeOrder({
      customer: { ...customer, phone: "12345" },
      address: { ...address, state: "Atlantis" },
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((i: { path: string[] }) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["customer.phone", "address.state"]));
  });

  it("returns 503 for Razorpay when keys are missing, but COD still works", async () => {
    app = testApp({ gateway: null, jobs });
    expect((await placeOrder()).status).toBe(503);
    expect((await placeOrder({ paymentMethod: "cod" })).status).toBe(201);
  });

  it("releases stock and cancels when the gateway fails", async () => {
    app = testApp({ gateway: fakeGateway({ fail: true }).gateway, jobs });
    const res = await placeOrder();
    expect(res.status).toBe(502);
    expect(await stockOf("rose-chrome")).toBe(20);
    expect((await Order.findOne().lean())?.status).toBe("cancelled");
  });
});

describe("POST /api/payments/razorpay/verify", () => {
  it("accepts a correct signature without marking the order paid", async () => {
    const o = await pendingOrder();
    const res = await request(app)
      .post("/api/payments/razorpay/verify")
      .send({
        orderNumber: o.orderNumber,
        razorpay_order_id: o.rzpOrderId,
        razorpay_payment_id: "pay_1",
        razorpay_signature: signPayment(o.rzpOrderId, "pay_1"),
      });
    expect(res.body).toEqual({ verified: true, status: "pending_payment" });
  });

  it.each([
    [
      "a tampered signature",
      (o: { rzpOrderId: string }) => ({
        razorpay_order_id: o.rzpOrderId,
        razorpay_signature: "0".repeat(64),
      }),
    ],
    [
      "a signature for another order",
      () => ({ razorpay_order_id: "order_other", razorpay_signature: signPayment("order_other", "pay_1") }),
    ],
    [
      "a non-hex signature",
      (o: { rzpOrderId: string }) => ({ razorpay_order_id: o.rzpOrderId, razorpay_signature: "zz" }),
    ],
  ])("rejects %s", async (_name, make) => {
    const o = await pendingOrder();
    const res = await request(app)
      .post("/api/payments/razorpay/verify")
      .send({ orderNumber: o.orderNumber, razorpay_payment_id: "pay_1", ...make(o) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
  });
});

describe("POST /api/webhooks/razorpay", () => {
  const captured = (orderId: string, amount = 149900) => ({
    id: "pay_1",
    order_id: orderId,
    amount,
    status: "captured",
  });

  it("rejects a bad signature", async () => {
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", "deadbeef")
      .set("x-razorpay-event-id", "evt_1")
      .send(JSON.stringify({ event: "payment.captured", payload: {} }));
    expect(res.status).toBe(400);
  });

  it("marks the order placed on payment.captured and notifies once", async () => {
    const o = await pendingOrder();
    const res = await webhook("payment.captured", captured(o.rzpOrderId), "evt_1");
    expect(res.body).toEqual({ ok: true, outcome: "placed" });
    const order = await Order.findOne({ number: o.orderNumber }).lean();
    expect(order).toMatchObject({
      status: "placed",
      stockState: "committed",
      payment: { status: "captured", razorpayPaymentId: "pay_1" },
    });
    expect(jobs.notified).toHaveLength(1);
  });

  it("treats a replayed event as a no-op", async () => {
    const o = await pendingOrder();
    await webhook("payment.captured", captured(o.rzpOrderId), "evt_1");
    const before = await Order.findOne({ number: o.orderNumber }).lean();
    const stock = await stockOf("rose-chrome");

    const replay = await webhook("payment.captured", captured(o.rzpOrderId), "evt_1");
    expect(replay.status).toBe(200);
    expect(replay.body.outcome).toBe("duplicate");

    const after = await Order.findOne({ number: o.orderNumber }).lean();
    expect(after).toEqual(before);
    expect(await stockOf("rose-chrome")).toBe(stock);
    expect(jobs.notified).toHaveLength(1);
    expect(await ProcessedWebhook.countDocuments()).toBe(1);
  });

  it("handles concurrent duplicates of the same event exactly once", async () => {
    const o = await pendingOrder();
    const results = await Promise.all(
      [1, 2, 3].map(() => webhook("payment.captured", captured(o.rzpOrderId), "evt_1")),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.body.outcome === "placed")).toHaveLength(1);
    expect(jobs.notified).toHaveLength(1);
  });

  it("ignores order.paid after payment.captured (different event, same payment)", async () => {
    const o = await pendingOrder();
    await webhook("payment.captured", captured(o.rzpOrderId), "evt_1");
    const res = await webhook("order.paid", captured(o.rzpOrderId), "evt_2");
    expect(res.body.outcome).toBe("already_final");
    expect((await Order.findOne({ number: o.orderNumber }).lean())!.events).toHaveLength(2);
  });

  it("does not place an order when the amount does not match", async () => {
    const o = await pendingOrder();
    const res = await webhook("payment.captured", captured(o.rzpOrderId, 100), "evt_1");
    expect(res.body.outcome).toBe("amount_mismatch");
    expect((await Order.findOne({ number: o.orderNumber }).lean())!.status).toBe("pending_payment");
  });

  it("records a failure, then lets a retry succeed; a late failure never undoes a capture", async () => {
    const o = await pendingOrder();
    const failed = {
      ...captured(o.rzpOrderId),
      id: "pay_f",
      status: "failed",
      error_description: "Card declined",
    };
    expect((await webhook("payment.failed", failed, "evt_1")).body.outcome).toBe("payment_failed");
    let order = await Order.findOne({ number: o.orderNumber }).lean();
    expect(order).toMatchObject({
      status: "pending_payment",
      payment: { status: "failed", failureReason: "Card declined" },
    });

    expect((await webhook("payment.captured", captured(o.rzpOrderId), "evt_2")).body.outcome).toBe("placed");
    expect((await webhook("payment.failed", failed, "evt_3")).body.outcome).toBe("already_final");
    order = await Order.findOne({ number: o.orderNumber }).lean();
    expect(order).toMatchObject({ status: "placed", payment: { status: "captured" } });
  });

  it("acknowledges events for unknown orders and unhandled event types", async () => {
    expect((await webhook("payment.captured", captured("order_nope"), "evt_1")).body.outcome).toBe(
      "unknown_order",
    );
    expect((await webhook("refund.created", captured("order_nope"), "evt_2")).body.outcome).toBe("ignored");
  });
});

describe("expiry", () => {
  it("cancels an unpaid order once and returns the stock", async () => {
    const o = await pendingOrder();
    expect(await stockOf("rose-chrome")).toBe(19);
    const order = await Order.findOne({ number: o.orderNumber });
    expect(await cancelUnpaid(order!.id, "Payment not completed in time")).toBe(true);
    expect(await cancelUnpaid(order!.id, "Payment not completed in time")).toBe(false);
    expect(await stockOf("rose-chrome")).toBe(20);
    expect(await Order.findById(order!.id).lean()).toMatchObject({
      status: "cancelled",
      stockState: "released",
    });
  });

  it("does not touch a paid order", async () => {
    const o = await pendingOrder();
    await webhook("payment.captured", captured(o.rzpOrderId), "evt_1");
    const order = await Order.findOne({ number: o.orderNumber });
    expect(await cancelUnpaid(order!.id, "late")).toBe(false);
    expect(await stockOf("rose-chrome")).toBe(19);
  });

  it("honours a payment that lands after expiry and takes the stock again", async () => {
    const o = await pendingOrder();
    const order = await Order.findOne({ number: o.orderNumber });
    await cancelUnpaid(order!.id, "expired");
    expect((await webhook("payment.captured", captured(o.rzpOrderId), "evt_1")).body.outcome).toBe("placed");
    expect(await stockOf("rose-chrome")).toBe(19);
    const after = await Order.findById(order!.id).lean();
    expect(after).toMatchObject({ status: "placed", stockState: "committed" });
    expect(after!.events.at(-1)!.note).toContain("stock re-reserved");
  });

  function captured(orderId: string) {
    return { id: "pay_1", order_id: orderId, amount: 149900, status: "captured" };
  }
});

describe("guest tracking and payment retry", () => {
  it("shows the order to someone with the link, without contact details", async () => {
    const o = await pendingOrder();
    const res = await request(app)
      .get("/api/orders/track")
      .query({ number: o.orderNumber, token: o.trackToken });
    expect(res.status).toBe(200);
    const t = trackedOrderSchema.parse(res.body);
    expect(t).toMatchObject({
      firstName: "Riya",
      city: "New Delhi",
      status: "pending_payment",
      deliveryDays: [1, 2],
    });
    expect(res.text).not.toContain("9876543210");
    expect(res.text).not.toContain("riya@example.com");
    expect(res.text).not.toContain("Park Street");
  });

  it.each([
    ["a wrong token", (o: { orderNumber: string }) => ({ number: o.orderNumber, token: "x".repeat(32) })],
    ["a malformed token", (o: { orderNumber: string }) => ({ number: o.orderNumber, token: "short" })],
    ["an unknown number", (o: { trackToken: string }) => ({ number: "HN999999", token: o.trackToken })],
  ])("returns the same 404 for %s", async (_name, make) => {
    const o = await pendingOrder();
    const res = await request(app).get("/api/orders/track").query(make(o));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("lets an unpaid order retry payment against the same Razorpay order, and refuses once paid", async () => {
    const o = await pendingOrder();
    const pay = () =>
      request(app).post("/api/orders/pay").send({ number: o.orderNumber, token: o.trackToken });
    const res = await pay();
    expect(res.body.razorpay).toMatchObject({ orderId: o.rzpOrderId, amount: 149900 });
    await webhook("payment.captured", { id: "pay_1", order_id: o.rzpOrderId, amount: 149900 }, "evt_1");
    expect((await pay()).status).toBe(409);
  });
});
