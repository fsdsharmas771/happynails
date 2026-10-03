import {
  availabilityResponseSchema,
  bookingConfirmationSchema,
  istToUtc,
  servicesResponseSchema,
} from "@happynails/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { queueBookingReminders } from "../jobs/queues";
import { AvailabilityBlock, AvailabilityRule, Booking, Service, Technician, Addon } from "../models/Booking";
import { seedBookingSetup } from "../seed/bookings";
import { fakeJobs, testApp, type FakeJobs } from "../test/app";
import { useTestDb } from "../test/db";
import { useTestRedis } from "../test/redis";

useTestDb();
const { redis, keyPrefix } = useTestRedis();

// Monday 5 October 2026, 08:30 in India.
const NOW = istToUtc("2026-10-05", "08:30");
let jobs: FakeJobs;
let app: ReturnType<typeof testApp>;
let ids: { manicure: string; gelx: string; nailArt: string; removal: string; techA: string; techB: string };

beforeEach(async () => {
  await seedBookingSetup();
  jobs = fakeJobs();
  app = testApp({ redis, keyPrefix, jobs, now: () => NOW });
  const svc = async (name: string) => String((await Service.findOne({ name }).lean())!._id);
  const add = async (name: string) => String((await Addon.findOne({ name }).lean())!._id);
  const techs = await Technician.find().sort({ _id: 1 }).lean();
  ids = {
    manicure: await svc("Gel manicure"), // 60 min
    gelx: await svc("Gel-X extensions, full set"), // 120 min
    nailArt: await add("Nail art"), // 20 min
    removal: await add("Removal of old gel"), // 20 min
    techA: String(techs[0]!._id),
    techB: String(techs[1]!._id),
  };
});

const at = (date: string, time: string) => istToUtc(date, time).toISOString();

async function availability(
  params: { city?: string; serviceId?: string; addonIds?: string[]; month?: string } = {},
) {
  const res = await request(app)
    .get("/api/availability")
    .query({
      city: params.city ?? "Delhi",
      serviceId: params.serviceId ?? ids.manicure,
      month: params.month ?? "2026-10",
      ...(params.addonIds?.length ? { addonIds: params.addonIds.join(",") } : {}),
    });
  expect(res.status).toBe(200);
  return availabilityResponseSchema.parse(res.body);
}
const day = (a: Awaited<ReturnType<typeof availability>>, date: string) =>
  a.days.find((d) => d.date === date)!;
const openTimes = (a: Awaited<ReturnType<typeof availability>>, date: string) =>
  day(a, date)
    .slots.filter((s) => s.open)
    .map((s) => s.time);

function hold(startsAt: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/bookings/hold")
    .send({ city: "Delhi", serviceId: ids.manicure, startsAt, ...body });
}

function confirm(holdToken: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/bookings")
    .send({
      holdToken,
      customer: { name: "Meher Kapoor", phone: "9876543210" },
      pincode: "110017",
      address: "B-12, Saket, New Delhi",
      ...body,
    });
}

async function insertBooking(techId: string, startsAt: string, minutes: number) {
  const start = new Date(startsAt);
  return Booking.create({
    number: `HN-VTEST${Math.random().toString().slice(2, 8)}`,
    customer: { name: "X", phone: "9876543210" },
    city: "Delhi",
    pincode: "110017",
    address: "Somewhere in Delhi",
    serviceId: ids.gelx,
    serviceName: "Gel-X",
    totalPaise: 100,
    minutes,
    technicianId: techId,
    startsAt: start,
    endsAt: new Date(start.getTime() + minutes * 60_000),
    status: "confirmed",
  });
}

describe("GET /api/services and POST /api/pincode/check", () => {
  it("lists active services and add-ons with prices in paise", async () => {
    await Service.updateOne({ name: "Bridal trial" }, { active: false });
    const body = servicesResponseSchema.parse((await request(app).get("/api/services")).body);
    expect(body.services.map((s) => s.name)).toEqual([
      "Gel manicure",
      "Gel-X extensions, full set",
      "Extension refill",
    ]);
    expect(body.addons.find((a) => a.name === "Nail art")).toMatchObject({
      unitNote: "per hand",
      pricePaise: 40000,
    });
  });

  it.each([
    ["110017", { covered: true, city: "Delhi" }],
    ["201305", { covered: true, city: "Noida" }],
    ["400001", { covered: false, city: null }],
  ])("checks %s", async (pincode, expected) => {
    expect((await request(app).post("/api/pincode/check").send({ pincode })).body).toEqual(expected);
  });
});

describe("GET /api/availability", () => {
  it("closes past days and slots under 3 hours away", async () => {
    const a = await availability();
    expect(day(a, "2026-10-04").openCount).toBe(0);
    // 10:00 is only 1.5 hours after 08:30, so it is too soon.
    expect(openTimes(a, "2026-10-05")).toEqual(["12:30", "15:00", "17:30", "19:30"]);
    expect(day(a, "2026-10-06").openCount).toBe(5);
    expect(day(a, "2026-10-06").slots[0]).toMatchObject({
      time: "10:00",
      startsAt: at("2026-10-06", "10:00"),
    });
  });

  it("closes days beyond the 90 day horizon", async () => {
    const jan = await availability({ month: "2027-01" });
    expect(day(jan, "2027-01-02").openCount).toBe(5);
    expect(day(jan, "2027-01-04").openCount).toBe(0);
  });

  it("stays open while any technician is free, closes when all are booked", async () => {
    await insertBooking(ids.techA, at("2026-10-06", "15:00"), 60);
    expect(openTimes(await availability(), "2026-10-06")).toContain("15:00");
    await insertBooking(ids.techB, at("2026-10-06", "15:00"), 60);
    expect(openTimes(await availability(), "2026-10-06")).not.toContain("15:00");
  });

  it("lets a long visit block the next slot for that technician", async () => {
    // 10:00 + 160 minutes runs to 12:40, over the 12:30 start.
    await insertBooking(ids.techA, at("2026-10-06", "10:00"), 160);
    await insertBooking(ids.techB, at("2026-10-06", "10:00"), 160);
    const a = await availability();
    expect(openTimes(a, "2026-10-06")).toEqual(["15:00", "17:30", "19:30"]);
  });

  it("only offers starts the whole visit fits: a 160 minute visit cannot start at 10:00 if 12:30 is taken", async () => {
    await insertBooking(ids.techA, at("2026-10-06", "12:30"), 60);
    await insertBooking(ids.techB, at("2026-10-06", "12:30"), 60);
    const short = await availability();
    const long = await availability({ serviceId: ids.gelx, addonIds: [ids.nailArt, ids.removal] });
    expect(long.minutes).toBe(160);
    expect(openTimes(short, "2026-10-06")).toContain("10:00");
    expect(openTimes(long, "2026-10-06")).not.toContain("10:00");
  });

  it("respects blocks, rule date ranges, inactive technicians and city coverage", async () => {
    await AvailabilityBlock.create({
      technicianId: ids.techA,
      fromDate: "2026-10-07",
      toDate: "2026-10-08",
      reason: "Leave",
    });
    await Technician.updateOne({ _id: ids.techB }, { cities: ["Noida"] });
    let a = await availability();
    expect(day(a, "2026-10-07").openCount).toBe(0);
    expect(day(a, "2026-10-09").openCount).toBe(5);
    expect(day(await availability({ city: "Noida" }), "2026-10-07").openCount).toBe(5);

    await AvailabilityRule.updateMany({ technicianId: ids.techA }, { validTo: "2026-10-20" });
    a = await availability();
    expect(day(a, "2026-10-20").openCount).toBe(5);
    expect(day(a, "2026-10-21").openCount).toBe(0);

    await Technician.updateOne({ _id: ids.techA }, { active: false });
    expect(day(await availability(), "2026-10-09").openCount).toBe(0);
  });

  it("validates the query", async () => {
    const bad = await request(app)
      .get("/api/availability")
      .query({ city: "Mumbai", serviceId: ids.manicure, month: "2026-10" });
    expect(bad.status).toBe(400);
    const unknown = await request(app)
      .get("/api/availability")
      .query({ city: "Delhi", serviceId: "a".repeat(24), month: "2026-10" });
    expect(unknown.status).toBe(404);
  });
});

describe("holds", () => {
  it("holds a slot for one technician, then the other, then refuses", async () => {
    const slot = at("2026-10-06", "15:00");
    const first = await hold(slot);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ startsAt: slot, endsAt: at("2026-10-06", "16:00") });
    expect((await hold(slot)).status).toBe(201);
    const third = await hold(slot);
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("SLOT_TAKEN");
    expect(openTimes(await availability(), "2026-10-06")).not.toContain("15:00");
  });

  it("gives exactly one hold per technician under concurrency", async () => {
    const slot = at("2026-10-06", "17:30");
    const results = await Promise.all(Array.from({ length: 6 }, () => hold(slot)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it("makes a held long visit block overlapping starts", async () => {
    const long = { serviceId: ids.gelx, addonIds: [ids.nailArt, ids.removal] };
    expect((await hold(at("2026-10-06", "10:00"), long)).status).toBe(201);
    expect((await hold(at("2026-10-06", "10:00"), long)).status).toBe(201);
    // Both technicians are now held 10:00 to 12:40, so a 12:30 start is impossible.
    expect((await hold(at("2026-10-06", "12:30"))).status).toBe(409);
    expect(openTimes(await availability(), "2026-10-06")).not.toContain("12:30");
  });

  it("refuses slots that are too soon, too far, or not on the schedule", async () => {
    expect((await hold(at("2026-10-05", "10:00"))).status).toBe(409);
    expect((await hold(at("2027-01-05", "10:00"))).status).toBe(409);
    expect((await hold(at("2026-10-06", "11:00"))).status).toBe(409);
  });

  it("releases a hold on request", async () => {
    const slot = at("2026-10-06", "19:30");
    const a = await hold(slot);
    await hold(slot);
    await request(app).delete(`/api/bookings/hold/${a.body.holdToken}`).expect(204);
    expect((await hold(slot)).status).toBe(201);
  });
});

describe("POST /api/bookings", () => {
  it("confirms a held slot with server-side totals and notifies", async () => {
    const h = await hold(at("2026-10-06", "10:00"), { serviceId: ids.gelx, addonIds: [ids.nailArt] });
    const res = await confirm(h.body.holdToken, { notes: "Allergic to acetone" });
    expect(res.status).toBe(201);
    const b = bookingConfirmationSchema.parse(res.body);
    expect(b).toMatchObject({
      firstName: "Meher",
      city: "Delhi",
      serviceName: "Gel-X extensions, full set",
      addonNames: ["Nail art"],
      minutes: 140,
      totalPaise: 249900 + 40000,
      startsAt: at("2026-10-06", "10:00"),
      endsAt: at("2026-10-06", "12:20"),
    });
    expect(b.number).toMatch(/^HN-V\d{6}$/);
    const saved = await Booking.findOne({ number: b.number }).lean();
    expect(saved).toMatchObject({
      status: "confirmed",
      technicianId: expect.anything(),
      notes: "Allergic to acetone",
    });
    expect(jobs.notified).toEqual([{ type: "booking_confirmed", bookingId: String(saved!._id) }]);
    // The hold is consumed.
    expect((await confirm(h.body.holdToken)).body.error.code).toBe("HOLD_EXPIRED");
  });

  it("refuses an unknown or expired hold", async () => {
    const res = await confirm("x".repeat(32));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("HOLD_EXPIRED");
  });

  it("refuses a pincode outside the held city", async () => {
    const h = await hold(at("2026-10-06", "10:00"));
    const res = await confirm(h.body.holdToken, { pincode: "122002" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "PINCODE_NOT_COVERED", details: { city: "Gurgaon" } });
  });

  it("returns 409 if the technician got booked another way after the hold", async () => {
    const h = await hold(at("2026-10-06", "15:00"));
    // e.g. the owner books the same technician by hand in the admin.
    await insertBooking(ids.techA, at("2026-10-06", "14:30"), 60);
    await insertBooking(ids.techB, at("2026-10-06", "14:30"), 60);
    const res = await confirm(h.body.holdToken);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SLOT_TAKEN");
  });

  it("has a database-level guard against two confirmed bookings at the same start", async () => {
    await insertBooking(ids.techA, at("2026-10-06", "15:00"), 60);
    await expect(insertBooking(ids.techA, at("2026-10-06", "15:00"), 60)).rejects.toMatchObject({
      code: 11000,
    });
    // A cancelled booking does not block the slot.
    await Booking.updateMany({ technicianId: ids.techA }, { status: "cancelled" });
    await expect(insertBooking(ids.techA, at("2026-10-06", "15:00"), 60)).resolves.toBeTruthy();
  });

  it("validates details", async () => {
    const h = await hold(at("2026-10-06", "10:00"));
    const res = await confirm(h.body.holdToken, { customer: { name: "M", phone: "123" }, address: "short" });
    expect(res.status).toBe(400);
  });
});

describe("next slot and reminders", () => {
  it("reports the next open slot in a city", async () => {
    const res = await request(app).get("/api/availability/next").query({ city: "Noida" });
    expect(res.body).toEqual({ city: "Noida", startsAt: at("2026-10-05", "12:30") });
  });

  it("queues one reminder per visit tomorrow, and none on a rerun", async () => {
    const tomorrow = await insertBooking(ids.techA, at("2026-10-06", "10:00"), 60);
    await insertBooking(ids.techA, at("2026-10-07", "10:00"), 60);
    const cancelled = await insertBooking(ids.techB, at("2026-10-06", "12:30"), 60);
    await Booking.updateOne({ _id: cancelled._id }, { status: "cancelled" });

    const evening = istToUtc("2026-10-05", "18:00");
    const recorder = fakeJobs();
    expect(await queueBookingReminders(recorder, evening)).toBe(1);
    expect(recorder.notified).toEqual([{ type: "booking_reminder", bookingId: String(tomorrow._id) }]);
    expect(await queueBookingReminders(recorder, evening)).toBe(0);
  });
});
