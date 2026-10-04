import { pino } from "pino";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../admin/auth";
import { AdminUser } from "../models/Admin";
import { Order } from "../models/Order";
import { seedProducts } from "../seed/seedProducts";
import {
  createShiprocketProvider,
  orderStepForCourierStatus,
  ShiprocketError,
  type ShippingProvider,
} from "../shipping/shiprocket";
import { fakeGateway, fakeJobs, signWebhook, TEST_COURIER_TOKEN, testApp, type FakeJobs } from "../test/app";
import { useTestDb } from "../test/db";

useTestDb();
const log = pino({ level: "silent" });
const H = { "x-hn-admin": "1" };

interface Call {
  url: string;
  body: Record<string, unknown>;
  auth: string | undefined;
}

function fakeShiprocket(opts: { failAssign?: boolean; expireOnce?: boolean } = {}) {
  const calls: Call[] = [];
  let expired = opts.expireOnce ?? false;
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ url, body, auth });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (url.endsWith("/auth/login")) return json(200, { token: `tok${calls.length}` });
    if (expired) {
      expired = false;
      return json(401, { message: "Token has expired" });
    }
    if (url.endsWith("/orders/create/adhoc"))
      return json(200, { order_id: 9001, shipment_id: 7001, status: "NEW" });
    if (url.endsWith("/courier/assign/awb")) {
      return opts.failAssign
        ? json(400, { message: "No courier serviceable" })
        : json(200, {
            awb_assign_status: 1,
            response: { data: { awb_code: "AWB123", courier_name: "Delhivery" } },
          });
    }
    if (url.endsWith("/courier/generate/pickup")) return json(200, { pickup_status: 1 });
    return json(404, { message: "unknown" });
  }) as unknown as typeof fetch;
  return {
    calls,
    provider: createShiprocketProvider(
      { email: "api@x.in", password: "pw", pickupLocation: "Home" },
      log,
      impl,
    ),
  };
}

const input = {
  orderNumber: "HN260042",
  orderDate: new Date("2026-10-04T06:30:00Z"),
  customer: { name: "Riya Kumari Sharma", phone: "9876543210", email: "riya@example.com" },
  address: { line: "12 Park Street", pincode: "110016", city: "New Delhi", state: "Delhi" },
  items: [{ name: "Rose Chrome (Standard kit)", sku: "rose-chrome-standard", qty: 2, unitPaise: 149900 }],
  shippingPaise: 0,
  totalPaise: 299800,
};

describe("Shiprocket client", () => {
  it("signs in once, creates the order, assigns a courier and books pickup", async () => {
    const { calls, provider } = fakeShiprocket();
    const r = await provider.ship(input);
    expect(r).toEqual({
      srOrderId: "9001",
      shipmentId: "7001",
      awb: "AWB123",
      courierName: "Delhivery",
      trackingUrl: "https://shiprocket.co/tracking/AWB123",
    });
    expect(calls.map((c) => c.url.replace("https://apiv2.shiprocket.in/v1/external", ""))).toEqual([
      "/auth/login",
      "/orders/create/adhoc",
      "/courier/assign/awb",
      "/courier/generate/pickup",
    ]);
    expect(calls[1]!.body).toMatchObject({
      order_id: "HN260042",
      order_date: "2026-10-04 12:00",
      pickup_location: "Home",
      billing_customer_name: "Riya",
      billing_last_name: "Kumari Sharma",
      billing_state: "Delhi",
      billing_country: "India",
      shipping_is_billing: true,
      payment_method: "Prepaid",
      sub_total: 2998,
      order_items: [{ name: "Rose Chrome (Standard kit)", units: 2, selling_price: 1499, hsn: "3304" }],
    });
    expect(calls[1]!.auth).toBe("Bearer tok1");
    expect(calls[2]!.body).toEqual({ shipment_id: 7001 });

    await provider.ship(input);
    expect(calls.filter((c) => c.url.endsWith("/auth/login"))).toHaveLength(1);
  });

  it("signs in again when the token has expired", async () => {
    const { calls, provider } = fakeShiprocket({ expireOnce: true });
    await provider.ship(input);
    expect(calls.filter((c) => c.url.endsWith("/auth/login"))).toHaveLength(2);
  });

  it("keeps the shipment ids when no courier can be assigned", async () => {
    const { provider } = fakeShiprocket({ failAssign: true });
    const err = await provider.ship(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShiprocketError);
    expect((err as ShiprocketError).partial).toEqual({ srOrderId: "9001", shipmentId: "7001" });
  });

  it("maps courier statuses to order steps", () => {
    expect(orderStepForCourierStatus("PICKED UP")).toBe("shipped");
    expect(orderStepForCourierStatus("In Transit")).toBe("shipped");
    expect(orderStepForCourierStatus("OUT FOR DELIVERY")).toBe("shipped");
    expect(orderStepForCourierStatus("DELIVERED")).toBe("delivered");
    expect(orderStepForCourierStatus("RTO DELIVERED")).toBeNull();
    expect(orderStepForCourierStatus("OUT FOR PICKUP")).toBeNull();
  });
});

describe("shipping orders from the admin, and courier updates", () => {
  let jobs: FakeJobs;
  let app: ReturnType<typeof testApp>;
  const provider: ShippingProvider = {
    async ship() {
      return {
        srOrderId: "9001",
        shipmentId: "7001",
        awb: "AWB777",
        courierName: "Blue Dart",
        trackingUrl: "https://shiprocket.co/tracking/AWB777",
      };
    },
  };

  beforeEach(async () => {
    await seedProducts();
    await AdminUser.create({
      email: "staff@example.com",
      name: "Priya",
      role: "staff",
      passwordHash: await hashPassword("staff-password-1"),
    });
    jobs = fakeJobs();
    app = testApp({ jobs, gateway: fakeGateway().gateway, shipping: provider });
  });

  async function paidOrder() {
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ slug: "milk-bath", option: "standard", qty: 1 }],
        customer: { name: "Riya Sharma", phone: "9876543210", email: "riya@example.com" },
        address: { line: "12 Park Street, Main Road", pincode: "110016", city: "New Delhi", state: "Delhi" },
        shippingSpeed: "standard",
      });
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: "pay_s", order_id: res.body.razorpay.orderId, amount: res.body.totalPaise },
        },
      },
    });
    await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signWebhook(body))
      .set("x-razorpay-event-id", "evt_s")
      .send(body);
    return (await Order.findOne({ number: res.body.orderNumber }))!;
  }

  const courier = (awb: string, status: string, token = TEST_COURIER_TOKEN) =>
    request(app)
      .post("/api/webhooks/courier-tracking")
      .set("x-api-key", token)
      .send({ awb, current_status: status });

  it("books the courier, then follows tracking to delivered, telling the customer once", async () => {
    const order = await paidOrder();
    const staff = request.agent(app);
    await staff
      .post("/api/admin/auth/login")
      .set(H)
      .send({ email: "staff@example.com", password: "staff-password-1" })
      .expect(200);
    const shipped = await staff.post(`/api/admin/orders/${order.id}/shiprocket`).set(H).send({});
    expect(shipped.body).toMatchObject({
      status: "packed",
      tracking: { carrier: "Blue Dart", awb: "AWB777" },
      shiprocket: { shipmentId: "7001" },
    });
    expect((await staff.post(`/api/admin/orders/${order.id}/shiprocket`).set(H).send({})).status).toBe(409);

    expect((await courier("AWB777", "PICKED UP", "wrong-token-value")).status).toBe(401);
    expect((await courier("AWB777", "PICKED UP")).body.outcome).toBe("shipped");
    expect(jobs.notified.filter((j) => j.type === "order_shipped")).toHaveLength(1);
    expect((await courier("AWB777", "PICKED UP")).body.outcome).toBe("unchanged");
    expect((await courier("AWB777", "IN TRANSIT")).body.outcome).toBe("shipped");
    expect((await courier("AWB777", "DELIVERED")).body.outcome).toBe("delivered");
    expect(jobs.notified.filter((j) => j.type === "order_shipped")).toHaveLength(1);
    expect((await courier("NOPE", "DELIVERED")).body.outcome).toBe("unknown_awb");
    expect((await courier("AWB777", "")).status).toBe(200);
  });
});
