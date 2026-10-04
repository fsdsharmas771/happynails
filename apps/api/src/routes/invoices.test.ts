import { invoiceSchema, istDateOf, istToUtc } from "@happynails/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../admin/auth";
import { AdminUser } from "../models/Admin";
import { Booking, Service } from "../models/Booking";
import { Invoice } from "../models/Invoice";
import { seedProducts } from "../seed/seedProducts";
import { fakeGateway, fakeJobs, signWebhook, testApp } from "../test/app";
import { useTestDb } from "../test/db";
import { seedTwoTechnicians } from "../test/fixtures";
import { useTestRedis } from "../test/redis";

useTestDb();
const { redis, keyPrefix } = useTestRedis();
const H = { "x-hn-admin": "1" };
let app: ReturnType<typeof testApp>;

beforeEach(async () => {
  await seedProducts();
  await seedTwoTechnicians();
  await AdminUser.create({
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    passwordHash: await hashPassword("owner-password-1"),
  });
  app = testApp({ redis, keyPrefix, jobs: fakeJobs(), gateway: fakeGateway().gateway });
});

async function owner() {
  const agent = request.agent(app);
  await agent
    .post("/api/admin/auth/login")
    .set(H)
    .send({ email: "owner@example.com", password: "owner-password-1" })
    .expect(200);
  return agent;
}

function webhook(orderId: string, amount: number, eventId: string) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${eventId}`, order_id: orderId, amount, status: "captured" } } },
  });
  return request(app)
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signWebhook(body))
    .set("x-razorpay-event-id", eventId)
    .send(body);
}

async function paidOrder(state: string, pincode: string, eventId: string) {
  const res = await request(app)
    .post("/api/orders")
    .send({
      items: [{ slug: "rose-chrome", option: "standard", qty: 1 }],
      customer: { name: "Riya Sharma", phone: "9876543210", email: "riya@example.com" },
      address: { line: "12 Park Street, Main Road", pincode, city: "Somewhere", state },
      shippingSpeed: "express",
    });
  await webhook(res.body.razorpay.orderId, res.body.totalPaise, eventId);
  return res.body as {
    orderNumber: string;
    trackToken: string;
    totalPaise: number;
    razorpay: { orderId: string };
  };
}

describe("tax invoices for orders", () => {
  it("issues one invoice on payment: CGST + SGST within Uttar Pradesh", async () => {
    const o = await paidOrder("Uttar Pradesh", "201301", "evt_up");
    const inv = (await Invoice.findOne({ "source.number": o.orderNumber }).lean())!;
    expect(inv.number).toMatch(/^HN\/\d{2}-\d{2}\/00001$/);
    expect(inv.intraState).toBe(true);
    expect(inv.placeOfSupply).toMatchObject({ state: "Uttar Pradesh", code: "09" });
    // ₹1,499 set + ₹149 express, both 18% inclusive.
    expect(inv.lines.map((l) => [l.hsnSac, l.totalPaise])).toEqual([
      ["3304", 149900],
      ["996812", 14900],
    ]);
    expect(inv.totals).toMatchObject({ totalPaise: 164800, igstPaise: 0 });
    expect(inv.totals.taxablePaise + inv.totals.cgstPaise + inv.totals.sgstPaise).toBe(164800);
    expect(inv.supplier).toMatchObject({
      gstin: "09AAHCH2761F1ZK",
      legalName: "Haritash and Vasistha (OPC) Private Limited",
    });

    // A replayed webhook does not issue a second invoice.
    await webhook(o.razorpay.orderId, o.totalPaise, "evt_up_2");
    expect(await Invoice.countDocuments({ "source.number": o.orderNumber })).toBe(1);
  });

  it("uses IGST for delivery outside Uttar Pradesh, and the customer can open it", async () => {
    const o = await paidOrder("Delhi", "110016", "evt_dl");
    const track = await request(app)
      .get("/api/orders/track")
      .query({ number: o.orderNumber, token: o.trackToken });
    expect(track.body.invoiceNumber).toMatch(/^HN\//);
    const res = await request(app)
      .get("/api/orders/invoice")
      .query({ number: o.orderNumber, token: o.trackToken });
    const [inv] = invoiceSchema.array().parse(res.body);
    expect(inv).toMatchObject({
      intraState: false,
      placeOfSupply: { code: "07" },
      totals: { cgstPaise: 0, sgstPaise: 0 },
    });
    expect(inv!.totals.igstPaise).toBeGreaterThan(0);
    const wrong = await request(app)
      .get("/api/orders/invoice")
      .query({ number: o.orderNumber, token: "x".repeat(32) });
    expect(wrong.status).toBe(404);
  });

  it("issues a credit note for each refund, netted in the GST report and CSV", async () => {
    const o = await paidOrder("Uttar Pradesh", "201301", "evt_rf");
    const admin = await owner();
    const order = (await admin.get("/api/admin/orders").query({ q: o.orderNumber })).body.items[0];
    await admin
      .post(`/api/admin/orders/${order._id}/refund`)
      .set(H)
      .send({ amountPaise: 11800, reason: "Goodwill" })
      .expect(200);
    const cn = (await Invoice.findOne({ kind: "credit_note" }).lean())!;
    expect(cn.number).toMatch(/^HNCN\/\d{2}-\d{2}\/00001$/);
    expect(cn.againstNumber).toMatch(/^HN\//);
    expect(cn.totals).toMatchObject({
      totalPaise: 11800,
      taxablePaise: 10000,
      cgstPaise: 900,
      sgstPaise: 900,
    });

    const month = istDateOf(new Date()).slice(0, 7);
    const report = (await admin.get("/api/admin/gst").query({ month })).body;
    expect(report.summary).toMatchObject({ invoices: 1, creditNotes: 1, totalPaise: 164800 - 11800 });
    expect(report.byState).toEqual([expect.objectContaining({ code: "09", totalPaise: 164800 - 11800 })]);
    expect(report.byHsn.map((h: { hsnSac: string }) => h.hsnSac)).toEqual(["3304", "996812"]);

    const csv = await admin.get("/api/admin/gst.csv").query({ month });
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.text.trim().split("\n");
    expect(lines[0]).toContain("Taxable value,CGST,SGST,IGST,Total");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("Credit note");
    expect(lines[3]).toContain("-118.00");
  });
});

describe("tax invoices for home visits", () => {
  async function visit(city: "Noida" | "Delhi") {
    const service = (await Service.findOne({ name: "Gel manicure" }).lean())!;
    const admin = await owner();
    const startsAt = istToUtc(
      istDateOf(new Date(Date.now() + 5 * 86_400_000)),
      city === "Noida" ? "10:00" : "17:00",
    ).toISOString();
    const res = await admin
      .post("/api/admin/bookings")
      .set(H)
      .send({
        city,
        pincode: city === "Noida" ? "201301" : "110017",
        address: "Tower 3, Sector 18",
        customer: { name: "Sana Mehta", phone: "9000090000" },
        serviceId: String(service._id),
        startsAt,
      });
    expect(res.status).toBe(201);
    return { admin, booking: res.body };
  }

  it("issues an invoice when a pay-after visit is marked paid: Noida is intra-state", async () => {
    const { admin, booking } = await visit("Noida");
    expect(await Invoice.countDocuments()).toBe(0);
    await admin.post(`/api/admin/bookings/${booking._id}/mark-paid`).set(H).send({}).expect(200);
    const inv = (await Invoice.findOne({ "source.number": booking.number }).lean())!;
    expect(inv).toMatchObject({
      intraState: true,
      placeOfSupply: { code: "09" },
      paymentNote: "Paid after the visit (UPI or cash)",
    });
    expect(inv.lines[0]).toMatchObject({ hsnSac: "999722", totalPaise: 119900 });
  });

  it("uses IGST for a Delhi visit paid online", async () => {
    const { booking } = await visit("Delhi");
    await Booking.updateOne(
      { _id: booking._id },
      {
        $set: {
          "payment.method": "online",
          "payment.razorpayOrderId": "order_v1",
          status: "pending_payment",
        },
      },
    );
    await webhook("order_v1", booking.totalPaise, "evt_visit");
    const inv = (await Invoice.findOne({ "source.number": booking.number }).lean())!;
    expect(inv).toMatchObject({ intraState: false, placeOfSupply: { state: "Delhi", code: "07" } });
  });
});
