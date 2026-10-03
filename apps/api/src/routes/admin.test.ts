import { istToUtc } from "@happynails/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../admin/auth";
import { AdminUser, Testimonial } from "../models/Admin";
import { AvailabilityRule, Booking, Service, Technician } from "../models/Booking";
import { Order } from "../models/Order";
import { Product } from "../models/Product";
import { seedBookingSetup } from "../seed/bookings";
import { seedProducts } from "../seed/seedProducts";
import { fakeGateway, fakeJobs, signWebhook, testApp, type FakeJobs } from "../test/app";
import { useTestDb } from "../test/db";
import { useTestRedis } from "../test/redis";

useTestDb();
const { redis, keyPrefix } = useTestRedis();

const OWNER = { email: "owner@example.com", password: "owner-password-1" };
const STAFF = { email: "staff@example.com", password: "staff-password-1" };
const H = { "x-hn-admin": "1" };

let app: ReturnType<typeof testApp>;
let jobs: FakeJobs;
let gw: ReturnType<typeof fakeGateway>;

beforeEach(async () => {
  await seedProducts();
  await seedBookingSetup();
  await AdminUser.create([
    { ...OWNER, name: "Anamika", role: "owner", passwordHash: await hashPassword(OWNER.password) },
    { ...STAFF, name: "Priya", role: "staff", passwordHash: await hashPassword(STAFF.password) },
  ]);
  jobs = fakeJobs();
  gw = fakeGateway();
  app = testApp({ redis, keyPrefix, jobs, gateway: gw.gateway });
});

async function signIn(who: { email: string; password: string }) {
  const agent = request.agent(app);
  const res = await agent.post("/api/admin/auth/login").set(H).send(who);
  expect(res.status).toBe(200);
  return agent;
}

async function paidOrder() {
  const res = await request(app)
    .post("/api/orders")
    .send({
      items: [{ slug: "milk-bath", option: "standard", qty: 2 }],
      customer: { name: "Riya Sharma", phone: "9876543210", email: "riya@example.com" },
      address: { line: "12 Park Street, Hauz Khas", pincode: "110016", city: "New Delhi", state: "Delhi" },
      shippingSpeed: "standard",
    });
  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: { entity: { id: "pay_1", order_id: res.body.razorpay.orderId, amount: res.body.totalPaise } },
    },
  });
  await request(app)
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signWebhook(body))
    .set("x-razorpay-event-id", `evt_${res.body.orderNumber}`)
    .send(body);
  return (await Order.findOne({ number: res.body.orderNumber }))!;
}

describe("admin sign-in", () => {
  it("sets an httpOnly, SameSite=Strict session cookie scoped to the admin API", async () => {
    const res = await request(app).post("/api/admin/auth/login").set(H).send(OWNER);
    expect(res.body).toMatchObject({ email: OWNER.email, role: "owner", name: "Anamika" });
    const cookie = res.headers["set-cookie"]![0]!;
    expect(cookie).toMatch(/^hn_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/admin/);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("refuses wrong passwords and unknown emails with the same answer", async () => {
    const wrong = await request(app)
      .post("/api/admin/auth/login")
      .set(H)
      .send({ ...OWNER, password: "nope-nope-nope" });
    const unknown = await request(app)
      .post("/api/admin/auth/login")
      .set(H)
      .send({ email: "x@example.com", password: "whatever-1" });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("limits sign-in attempts", async () => {
    const attempts = [];
    for (let i = 0; i < 11; i++) {
      attempts.push(
        (
          await request(app)
            .post("/api/admin/auth/login")
            .set(H)
            .send({ ...OWNER, password: "bad-password" })
        ).status,
      );
    }
    expect(attempts.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(attempts[10]).toBe(429);
  });

  it("requires a session, and signs out", async () => {
    expect((await request(app).get("/api/admin/auth/me")).status).toBe(401);
    const agent = await signIn(OWNER);
    expect((await agent.get("/api/admin/auth/me")).body).toMatchObject({ role: "owner" });
    await agent.post("/api/admin/auth/logout").set(H).expect(204);
    expect((await agent.get("/api/admin/auth/me")).status).toBe(401);
  });

  it("ends sessions of a deactivated user or after a token version bump", async () => {
    const agent = await signIn(STAFF);
    await AdminUser.updateOne({ email: STAFF.email }, { $inc: { tokenVersion: 1 } });
    expect((await agent.get("/api/admin/auth/me")).status).toBe(401);
  });

  it("refuses state changes without the admin header (cross-site request defence)", async () => {
    const agent = await signIn(OWNER);
    const res = await agent.post("/api/admin/products/reorder").send({ ids: [] });
    expect(res.status).toBe(403);
    expect((await request(app).post("/api/admin/auth/login").send(OWNER)).status).toBe(403);
  });

  it("keeps owner-only actions away from staff", async () => {
    const staff = await signIn(STAFF);
    const product = (await Product.findOne({ slug: "milk-bath" }))!;
    expect(
      (await staff.patch(`/api/admin/products/${product.id}`).set(H).send({ pricePaise: 1 })).status,
    ).toBe(403);
    expect((await staff.post("/api/admin/technicians").set(H).send({})).status).toBe(403);
    // Staff can still count stock.
    const stock = await staff
      .post(`/api/admin/products/${product.id}/stock`)
      .set(H)
      .send({ delta: 5, reason: "Delivery from supplier" });
    expect(stock.body.stock).toBe(25);
  });
});

describe("products", () => {
  it("creates, edits, reorders and adjusts stock", async () => {
    const owner = await signIn(OWNER);
    const created = await owner.post("/api/admin/products").set(H).send({
      slug: "lilac-haze",
      name: "Lilac Haze",
      shape: "oval",
      finish: "gloss",
      occasion: "everyday",
      color: "#C8B6E2",
      pricePaise: 109900,
      stock: 5,
    });
    expect(created.status).toBe(201);
    expect(
      (
        await owner
          .post("/api/admin/products")
          .set(H)
          .send({ ...created.body, _id: undefined })
      ).status,
    ).toBe(409);

    const edited = await owner
      .patch(`/api/admin/products/${created.body._id}`)
      .set(H)
      .send({ pricePaise: 99900, active: false });
    expect(edited.body).toMatchObject({ pricePaise: 99900, active: false });
    expect((await request(app).get("/api/products/lilac-haze")).status).toBe(404);

    const tooLow = await owner
      .post(`/api/admin/products/${created.body._id}/stock`)
      .set(H)
      .send({ delta: -6, reason: "Damaged" });
    expect(tooLow.status).toBe(409);

    const ids = (await Product.find().sort({ sortOrder: -1 }).lean()).map((p) => String(p._id));
    const reordered = await owner.post("/api/admin/products/reorder").set(H).send({ ids });
    expect(reordered.body.map((p: { _id: string }) => p._id)).toEqual(ids);
  });

  it("an edit changes only the fields sent (no defaults overwrite the rest)", async () => {
    const owner = await signIn(OWNER);
    const p = (await Product.findOne({ slug: "rose-chrome" }))!;
    await Product.updateOne(
      { _id: p._id },
      { active: false, images: [{ url: "/uploads/a.png", alt: "Rose" }] },
    );
    const res = await owner.patch(`/api/admin/products/${p.id}`).set(H).send({ pricePaise: 155000 });
    expect(res.body).toMatchObject({
      pricePaise: 155000,
      active: false,
      description: p.description,
      images: [{ url: "/uploads/a.png", alt: "Rose" }],
    });
    const svc = (await Service.findOne({ name: "Gel manicure" }).lean())!;
    const s = await owner.patch(`/api/admin/services/${svc._id}`).set(H).send({ pricePaise: 129900 });
    expect(s.body).toMatchObject({ description: svc.description, sortOrder: svc.sortOrder, active: true });
  });

  it("validates input", async () => {
    const owner = await signIn(OWNER);
    const res = await owner
      .post("/api/admin/products")
      .set(H)
      .send({ slug: "Bad Slug", name: "x", color: "red" });
    expect(res.status).toBe(400);
  });
});

describe("orders", () => {
  it("moves a paid order along, needs tracking before shipping, and notifies on shipping", async () => {
    const order = await paidOrder();
    const staff = await signIn(STAFF);
    const step = (status: string) =>
      staff.post(`/api/admin/orders/${order.id}/status`).set(H).send({ status });

    expect((await step("shipped")).status).toBe(409);
    expect((await step("packed")).body.status).toBe("packed");
    expect((await step("shipped")).body.error.code).toBe("TRACKING_REQUIRED");
    await staff
      .post(`/api/admin/orders/${order.id}/tracking`)
      .set(H)
      .send({ carrier: "Delhivery", awb: "1234567890", url: "https://example.com/t/1" })
      .expect(200);
    expect((await step("shipped")).body.status).toBe("shipped");
    expect(jobs.notified.at(-1)).toEqual({ type: "order_shipped", orderId: order.id });
    expect((await step("delivered")).body.status).toBe("delivered");
    expect((await step("packed")).status).toBe(409);

    const list = await staff.get("/api/admin/orders").query({ q: "riya" });
    expect(list.body.total).toBe(1);
  });

  it("cancels an unshipped order, returns stock, then the owner refunds it", async () => {
    const order = await paidOrder();
    const before = (await Product.findOne({ slug: "milk-bath" }).lean())!.stock;
    const owner = await signIn(OWNER);
    const cancelled = await owner
      .post(`/api/admin/orders/${order.id}/cancel`)
      .set(H)
      .send({ note: "Customer asked" });
    expect(cancelled.body).toMatchObject({ status: "cancelled", stockState: "released" });
    expect((await Product.findOne({ slug: "milk-bath" }).lean())!.stock).toBe(before + 2);

    const tooMuch = await owner
      .post(`/api/admin/orders/${order.id}/refund`)
      .set(H)
      .send({ amountPaise: 10_000_000, reason: "x y" });
    expect(tooMuch.status).toBe(400);
    const part = await owner
      .post(`/api/admin/orders/${order.id}/refund`)
      .set(H)
      .send({ amountPaise: 10000, reason: "Goodwill" });
    expect(part.body.refunds).toHaveLength(1);
    expect(part.body.payment.status).toBe("captured");
    const rest = await owner
      .post(`/api/admin/orders/${order.id}/refund`)
      .set(H)
      .send({ reason: "Cancelled order" });
    expect(rest.body).toMatchObject({ status: "refunded", payment: { status: "refunded" } });
    expect(gw.refunds).toEqual([
      { paymentId: "pay_1", amount: 10000 },
      { paymentId: "pay_1", amount: order.totalPaise - 10000 },
    ]);
    expect(
      (await owner.post(`/api/admin/orders/${order.id}/refund`).set(H).send({ reason: "Again" })).status,
    ).toBe(409);
  });
});

describe("bookings", () => {
  const at = (date: string, time: string) => istToUtc(date, time).toISOString();
  async function manual(agent: Awaited<ReturnType<typeof signIn>>, body: Record<string, unknown>) {
    const service = (await Service.findOne({ name: "Gel manicure" }).lean())!;
    return agent
      .post("/api/admin/bookings")
      .set(H)
      .send({
        city: "Delhi",
        pincode: "110017",
        address: "B-12, Saket, New Delhi",
        customer: { name: "Phone Customer", phone: "9876543210" },
        serviceId: String(service._id),
        startsAt: at("2030-01-07", "11:00"),
        ...body,
      });
  }

  it("books by hand under the same travel rules, then reschedules, completes and records payment", async () => {
    const staff = await signIn(STAFF);
    const techs = await Technician.find().sort({ _id: 1 }).lean();
    const a = await manual(staff, { technicianId: String(techs[0]!._id) });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: "confirmed", payment: { method: "after_visit", status: "due" } });
    expect(jobs.notified.at(-1)).toMatchObject({ type: "booking_confirmed" });

    // Same technician in Noida two hours later: inside the 4 hour cross-river gap.
    const clash = await manual(staff, {
      technicianId: String(techs[0]!._id),
      city: "Noida",
      pincode: "201301",
      startsAt: at("2030-01-07", "14:00"),
    });
    expect(clash.status).toBe(409);
    // Without a named technician, the other one is free.
    const other = await manual(staff, {
      city: "Noida",
      pincode: "201301",
      startsAt: at("2030-01-07", "14:00"),
    });
    expect(String(other.body.technicianId)).toBe(String(techs[1]!._id));

    const moved = await staff
      .post(`/api/admin/bookings/${a.body._id}/reschedule`)
      .set(H)
      .send({ startsAt: at("2030-01-08", "10:00") });
    expect(moved.body.startsAt).toBe(at("2030-01-08", "10:00"));
    expect((await staff.post(`/api/admin/bookings/${a.body._id}/complete`).set(H).send({})).body.status).toBe(
      "completed",
    );
    const paid = await staff.post(`/api/admin/bookings/${a.body._id}/mark-paid`).set(H).send({});
    expect(paid.body.payment.status).toBe("paid_after_visit");

    const list = await staff
      .get("/api/admin/bookings")
      .query({ from: "2030-01-07", to: "2030-01-08", city: "Noida" });
    expect(list.body).toHaveLength(1);
  });

  it("cancels with a notification and refunds a visit paid online", async () => {
    const owner = await signIn(OWNER);
    const b = await manual(owner, {});
    await Booking.updateOne(
      { _id: b.body._id },
      { $set: { payment: { method: "online", status: "captured", razorpayPaymentId: "pay_v" } } },
    );
    const cancelled = await owner
      .post(`/api/admin/bookings/${b.body._id}/cancel`)
      .set(H)
      .send({ note: "Rain" });
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.events.at(-1).note).toContain("refund needed");
    expect(jobs.notified.at(-1)).toEqual({ type: "booking_cancelled", bookingId: b.body._id });
    const refunded = await owner
      .post(`/api/admin/bookings/${b.body._id}/refund`)
      .set(H)
      .send({ reason: "Cancelled for rain" });
    expect(refunded.body.payment.status).toBe("refunded");

    const dash = await owner.get("/api/admin/dashboard");
    expect(dash.body).toMatchObject({ needsRefund: 0, ordersToPack: { count: 0 } });
  });
});

describe("technicians, services, testimonials and uploads", () => {
  it("manages a technician's week and leave", async () => {
    const owner = await signIn(OWNER);
    const t = await owner
      .post("/api/admin/technicians")
      .set(H)
      .send({ name: "Kavya", phone: "9811111111", cities: ["Gurgaon"] });
    expect(t.status).toBe(201);
    await owner
      .put(`/api/admin/technicians/${t.body._id}/hours`)
      .set(H)
      .send({ days: [{ weekday: 1, slotTimes: ["15:00", "10:00", "10:00"] }] })
      .expect(200);
    expect(
      (await AvailabilityRule.find({ technicianId: t.body._id }).lean()).map((r) => r.slotTimes),
    ).toEqual([["10:00", "15:00"]]);
    const bad = await owner
      .post(`/api/admin/technicians/${t.body._id}/blocks`)
      .set(H)
      .send({ fromDate: "2030-02-02", toDate: "2030-02-01" });
    expect(bad.status).toBe(400);
    const block = await owner
      .post(`/api/admin/technicians/${t.body._id}/blocks`)
      .set(H)
      .send({ fromDate: "2030-02-01", toDate: "2030-02-03", reason: "Leave" });
    expect(block.status).toBe(201);
    const list = await owner.get("/api/admin/technicians");
    const kavya = list.body.find((x: { name: string }) => x.name === "Kavya");
    expect(kavya.week).toEqual([{ weekday: 1, slotTimes: ["10:00", "15:00"] }]);
    expect(kavya.blocks).toHaveLength(1);
  });

  it("edits services", async () => {
    const owner = await signIn(OWNER);
    const s = (await Service.findOne({ name: "Bridal trial" }).lean())!;
    const res = await owner
      .patch(`/api/admin/services/${s._id}`)
      .set(H)
      .send({ pricePaise: 210000, active: false });
    expect(res.body).toMatchObject({ pricePaise: 210000, active: false });
    expect(
      (await request(app).get("/api/services")).body.services.map((x: { name: string }) => x.name),
    ).not.toContain("Bridal trial");
  });

  it("only shows published testimonials publicly", async () => {
    const owner = await signIn(OWNER);
    const t = await owner
      .post("/api/admin/testimonials")
      .set(H)
      .send({ name: "Riya", city: "Gurgaon", quote: "Lovely" });
    expect((await request(app).get("/api/testimonials")).body).toEqual([]);
    await owner.patch(`/api/admin/testimonials/${t.body._id}`).set(H).send({ published: true }).expect(200);
    expect((await request(app).get("/api/testimonials")).body).toMatchObject([
      { name: "Riya", quote: "Lovely" },
    ]);
    await owner.delete(`/api/admin/testimonials/${t.body._id}`).set(H).expect(204);
    expect(await Testimonial.countDocuments()).toBe(0);
  });

  it("accepts real images and refuses disguised or oversized files", async () => {
    const owner = await signIn(OWNER);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const ok = await owner
      .post("/api/admin/uploads")
      .query({ kind: "image" })
      .set(H)
      .attach("file", png, "nail.png");
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/uploads\/[a-f0-9]{32}\.png$/);
    const served = await request(app).get(ok.body.url);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");

    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const fake = await owner
      .post("/api/admin/uploads")
      .query({ kind: "image" })
      .set(H)
      .attach("file", html, "evil.png");
    expect(fake.status).toBe(415);
    const wrongKind = await owner
      .post("/api/admin/uploads")
      .query({ kind: "video" })
      .set(H)
      .attach("file", png, "x.mp4");
    expect(wrongKind.status).toBe(415);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(6 * 1024 * 1024)]);
    const tooBig = await owner
      .post("/api/admin/uploads")
      .query({ kind: "image" })
      .set(H)
      .attach("file", big, "big.jpg");
    expect(tooBig.status).toBe(413);
    const staff = await signIn(STAFF);
    expect(
      (await staff.post("/api/admin/uploads").query({ kind: "image" }).set(H).attach("file", png, "n.png"))
        .status,
    ).toBe(403);
  });
});
