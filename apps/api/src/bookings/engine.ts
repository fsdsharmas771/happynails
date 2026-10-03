import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  addIstDays,
  BOOKING_HORIZON_DAYS,
  BOOKING_MIN_LEAD_MS,
  HOLD_TTL_SECONDS,
  istDateOf,
  istToUtc,
  istWeekday,
  visitCityForPincode,
  type BookingAccess,
  type BookingConfirmation,
  type BookingPaymentMethod,
  type CreateBookingRequest,
  type HoldResponse,
  type IstDate,
  type IstTime,
  type TrackedBooking,
  type VisitCity,
} from "@happynails/shared";
import type { Redis } from "ioredis";
import mongoose, { type ClientSession, type Types } from "mongoose";
import type { Logger } from "pino";
import {
  BOOKING_PAYMENT_TIMEOUT_MS,
  gapMs,
  TRAVEL_GAP_MINUTES,
  travelSide,
  visitsClash,
  type TravelSide,
  type Visit,
} from "../config/bookings";
import { HttpError } from "../errors";
import type { Jobs } from "../jobs/types";
import {
  Addon,
  AvailabilityBlock,
  AvailabilityRule,
  Booking,
  Service,
  SLOT_BLOCKING_STATUSES,
  Technician,
  type BookingDoc,
} from "../models/Booking";
import { Counter } from "../models/Order";
import type { PaymentGateway } from "../payments/gateway";

export interface BookingDeps {
  redis: Redis;
  jobs: Jobs;
  log: Logger;
  gateway: PaymentGateway | null;
  /** Namespace for Redis keys; tests use their own. */
  keyPrefix?: string;
  now?: () => Date;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const slotTaken = () =>
  new HttpError(409, "SLOT_TAKEN", "That time has just been taken. Please pick another.");

// ---------- service selection ----------

export interface Selection {
  serviceId: string;
  serviceName: string;
  addons: { addonId: string; name: string; pricePaise: number; minutes: number }[];
  minutes: number;
  totalPaise: number;
}

export async function loadSelection(serviceId: string, addonIds: string[]): Promise<Selection> {
  const ids = [...new Set(addonIds)];
  const [service, addons] = await Promise.all([
    Service.findOne({ _id: serviceId, active: true }).lean(),
    ids.length
      ? Addon.find({ _id: { $in: ids }, active: true })
          .sort({ sortOrder: 1 })
          .lean()
      : [],
  ]);
  if (!service) throw new HttpError(404, "SERVICE_NOT_FOUND", "That service is not available");
  if (addons.length !== ids.length) throw new HttpError(404, "ADDON_NOT_FOUND", "An add-on is not available");
  return {
    serviceId: String(service._id),
    serviceName: service.name,
    addons: addons.map((a) => ({
      addonId: String(a._id),
      name: a.name,
      pricePaise: a.pricePaise,
      minutes: a.minutes,
    })),
    minutes: service.minutes + addons.reduce((m, a) => m + a.minutes, 0),
    totalPaise: service.pricePaise + addons.reduce((t, a) => t + a.pricePaise, 0),
  };
}

// ---------- schedule ----------

interface TechDay {
  techId: string;
  date: IstDate;
  /** Sorted slot start times this technician works that day. */
  grid: IstTime[];
}

async function techsFor(city: VisitCity) {
  return Technician.find({ active: true, cities: city }).sort({ _id: 1 }).select({ _id: 1 }).lean();
}

/** Working grids per technician per day, after rules and blocks. */
async function schedules(techIds: Types.ObjectId[], dates: IstDate[]): Promise<TechDay[]> {
  if (!techIds.length || !dates.length) return [];
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const [rules, blocks] = await Promise.all([
    AvailabilityRule.find({ technicianId: { $in: techIds } }).lean(),
    AvailabilityBlock.find({
      technicianId: { $in: techIds },
      fromDate: { $lte: last },
      toDate: { $gte: first },
    }).lean(),
  ]);
  const out: TechDay[] = [];
  for (const techId of techIds.map(String)) {
    for (const date of dates) {
      const weekday = istWeekday(date);
      const blocked = blocks.some(
        (b) => String(b.technicianId) === techId && b.fromDate <= date && b.toDate >= date,
      );
      if (blocked) continue;
      const times = new Set<IstTime>();
      for (const r of rules) {
        if (String(r.technicianId) !== techId || r.weekday !== weekday) continue;
        if ((r.validFrom && date < r.validFrom) || (r.validTo && date > r.validTo)) continue;
        r.slotTimes.forEach((t) => times.add(t));
      }
      if (times.size) out.push({ techId, date, grid: [...times].sort() });
    }
  }
  return out;
}

/** Visits that keep each technician busy in a window, widened by the longest travel gap. */
async function busyVisits(techIds: string[], from: Date, to: Date, session?: ClientSession) {
  const pad = TRAVEL_GAP_MINUTES.crossSide * 60_000;
  const docs = await Booking.find({
    technicianId: { $in: techIds },
    status: { $in: [...SLOT_BLOCKING_STATUSES] },
    startsAt: { $lt: new Date(to.getTime() + pad) },
    endsAt: { $gt: new Date(from.getTime() - pad) },
  })
    .select({ technicianId: 1, startsAt: 1, endsAt: 1, city: 1 })
    .session(session ?? null)
    .lean();
  const byTech = new Map<string, Visit[]>();
  for (const b of docs) {
    const list = byTech.get(String(b.technicianId)) ?? [];
    list.push({ start: b.startsAt.getTime(), end: b.endsAt.getTime(), side: travelSide(b.city) });
    byTech.set(String(b.technicianId), list);
  }
  return byTech;
}

/** Bookable window: at least 3 hours from now and within 90 days. */
function inWindow(startsAt: Date, now: Date): boolean {
  const t = startsAt.getTime();
  return t >= now.getTime() + BOOKING_MIN_LEAD_MS && t <= now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000;
}

// ---------- holds ----------

interface HoldRecord extends Selection {
  techId: string;
  city: VisitCity;
  side: TravelSide;
  /** Epoch ms, read by the Lua scripts. */
  startMs: number;
  endMs: number;
  startsAt: string;
  endsAt: string;
  consumed?: boolean;
}

const prefixOf = (deps: Pick<BookingDeps, "keyPrefix">) => deps.keyPrefix ?? "hn:";
const holdKey = (prefix: string, token: string) => `${prefix}hold:${token}`;
const techHoldsKey = (prefix: string, techId: string) => `${prefix}tech-holds:${techId}`;

/** Live holds per technician (expired tokens are skipped; the acquire script prunes them). */
async function liveHolds(techIds: string[], deps: Pick<BookingDeps, "redis" | "keyPrefix">) {
  const prefix = prefixOf(deps);
  const pipe = deps.redis.pipeline();
  techIds.forEach((id) => pipe.smembers(techHoldsKey(prefix, id)));
  const sets = ((await pipe.exec()) ?? []).map(([, v]) => (v as string[]) ?? []);
  const tokens = sets.flat();
  const values = tokens.length ? await deps.redis.mget(tokens.map((t) => holdKey(prefix, t))) : [];
  const byToken = new Map(tokens.map((t, i) => [t, values[i]]));
  const out = new Map<string, Visit[]>();
  techIds.forEach((id, i) => {
    out.set(
      id,
      sets[i]!.flatMap((t) => {
        const raw = byToken.get(t);
        if (!raw) return [];
        const h = JSON.parse(raw) as HoldRecord;
        return [{ start: h.startMs, end: h.endMs, side: h.side }];
      }),
    );
  });
  return out;
}

/**
 * Claims a technician atomically: fails if any live hold for that technician clashes with the new
 * visit under the travel-gap rules. Expired hold tokens are pruned on the way.
 */
const ACQUIRE = `
local tokens = redis.call('SMEMBERS', KEYS[1])
local s, e = tonumber(ARGV[4]), tonumber(ARGV[5])
for _, t in ipairs(tokens) do
  local raw = redis.call('GET', ARGV[9] .. t)
  if not raw then
    redis.call('SREM', KEYS[1], t)
  else
    local h = cjson.decode(raw)
    local gap = tonumber(ARGV[8])
    if h.side == ARGV[6] then gap = tonumber(ARGV[7]) end
    if s < h.endMs + gap and h.startMs < e + gap then return 0 end
  end
end
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[2])
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], 86400 * 2)
return 1`;

/** Marks a hold used so it cannot confirm twice; it keeps blocking until it expires. */
const CONSUME = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local h = cjson.decode(raw)
if h.consumed then return -1 end
h.consumed = true
redis.call('SET', KEYS[1], cjson.encode(h), 'KEEPTTL')
return 1`;

const UNCONSUME = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local h = cjson.decode(raw)
h.consumed = false
redis.call('SET', KEYS[1], cjson.encode(h), 'KEEPTTL')
return 1`;

export interface SlotInfo {
  time: IstTime;
  startsAt: Date;
  /** Technicians free for the whole visit plus travel, in assignment order. */
  freeTechIds: string[];
}

/**
 * Open slots for a city and visit length over some days: technicians covering the city, their
 * rules minus blocks, minus confirmed and awaiting-payment bookings and live holds, keeping the
 * travel gap (1 hour, or 4 hours between Noida and Delhi or Gurgaon) around every visit.
 */
export async function computeSlots(
  city: VisitCity,
  minutes: number,
  dates: IstDate[],
  deps: Pick<BookingDeps, "redis" | "keyPrefix" | "now">,
): Promise<Map<IstDate, SlotInfo[]>> {
  const now = deps.now?.() ?? new Date();
  const side = travelSide(city);
  const techs = await techsFor(city);
  const days = await schedules(
    techs.map((t) => t._id),
    dates,
  );
  const result = new Map<IstDate, Map<IstTime, SlotInfo>>(dates.map((d) => [d, new Map()]));

  if (days.length) {
    const techIds = [...new Set(days.map((d) => d.techId))];
    const from = istToUtc(dates[0]!, "00:00");
    const to = istToUtc(addIstDays(dates[dates.length - 1]!, 1), "00:00");
    const [booked, held] = await Promise.all([busyVisits(techIds, from, to), liveHolds(techIds, deps)]);

    for (const day of days) {
      const forDay = result.get(day.date)!;
      const busy = [...(booked.get(day.techId) ?? []), ...(held.get(day.techId) ?? [])];
      for (const time of day.grid) {
        const startsAt = istToUtc(day.date, time);
        const slot = forDay.get(time) ?? { time, startsAt, freeTechIds: [] };
        forDay.set(time, slot);
        if (!inWindow(startsAt, now)) continue;
        const visit = { start: startsAt.getTime(), end: startsAt.getTime() + minutes * 60_000, side };
        if (!busy.some((b) => visitsClash(visit, b))) slot.freeTechIds.push(day.techId);
      }
    }
  }

  return new Map(
    [...result].map(([date, m]) => [date, [...m.values()].sort((a, b) => a.time.localeCompare(b.time))]),
  );
}

export async function placeHold(
  input: { city: VisitCity; serviceId: string; addonIds: string[]; startsAt: string },
  deps: BookingDeps,
): Promise<HoldResponse> {
  const prefix = prefixOf(deps);
  const now = deps.now?.() ?? new Date();
  const selection = await loadSelection(input.serviceId, input.addonIds);
  const startsAt = new Date(input.startsAt);
  if (!inWindow(startsAt, now)) throw slotTaken();

  const date = istDateOf(startsAt);
  const slot = (await computeSlots(input.city, selection.minutes, [date], deps))
    .get(date)
    ?.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw slotTaken();

  const endsAt = new Date(startsAt.getTime() + selection.minutes * 60_000);
  const side = travelSide(input.city);
  const token = randomBytes(24).toString("base64url");

  // First free technician whose holds we can claim atomically wins.
  for (const techId of slot.freeTechIds) {
    const record: HoldRecord = {
      ...selection,
      techId,
      city: input.city,
      side,
      startMs: startsAt.getTime(),
      endMs: endsAt.getTime(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    const ok = await deps.redis.eval(
      ACQUIRE,
      2,
      techHoldsKey(prefix, techId),
      holdKey(prefix, token),
      token,
      String(HOLD_TTL_SECONDS),
      JSON.stringify(record),
      String(record.startMs),
      String(record.endMs),
      side,
      String(gapMs(side, side)),
      String(gapMs("noida", "delhi_gurgaon")),
      `${prefix}hold:`,
    );
    if (ok === 1) {
      return {
        holdToken: token,
        expiresAt: new Date(now.getTime() + HOLD_TTL_SECONDS * 1000).toISOString(),
        startsAt: record.startsAt,
        endsAt: record.endsAt,
      };
    }
  }
  throw slotTaken();
}

async function readHold(token: string, deps: BookingDeps): Promise<HoldRecord | null> {
  const raw = await deps.redis.get(holdKey(prefixOf(deps), token));
  return raw ? (JSON.parse(raw) as HoldRecord) : null;
}

export async function releaseHold(token: string, deps: BookingDeps): Promise<void> {
  const prefix = prefixOf(deps);
  const hold = await readHold(token, deps);
  // A used hold stays until it expires: it covers the gap before the booking is visible to everyone.
  if (!hold || hold.consumed) return;
  await deps.redis.multi().del(holdKey(prefix, token)).srem(techHoldsKey(prefix, hold.techId), token).exec();
}

// ---------- booking ----------

export async function nextBookingNumber(now = new Date()): Promise<string> {
  const yy = istDateOf(now).slice(2, 4);
  const c = await Counter.findOneAndUpdate(
    { _id: `booking-${yy}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return `HN-V${yy}${String(c!.seq).padStart(4, "0")}`;
}

/** Throws 409 if the technician is busy (with travel time) for this visit; runs inside a transaction. */
export async function assertTechnicianFree(
  techId: string,
  visit: { startsAt: Date; endsAt: Date; city: VisitCity },
  session: ClientSession,
  ignoreBookingId?: string,
) {
  const busy = await busyVisits([techId], visit.startsAt, visit.endsAt, session);
  const mine = { start: visit.startsAt.getTime(), end: visit.endsAt.getTime(), side: travelSide(visit.city) };
  const others = ignoreBookingId
    ? await Booking.find({
        _id: { $ne: ignoreBookingId },
        technicianId: techId,
        status: { $in: [...SLOT_BLOCKING_STATUSES] },
      })
        .select({ startsAt: 1, endsAt: 1, city: 1 })
        .session(session)
        .lean()
        .then((list) =>
          list.map((b) => ({
            start: b.startsAt.getTime(),
            end: b.endsAt.getTime(),
            side: travelSide(b.city),
          })),
        )
    : (busy.get(techId) ?? []);
  if (others.some((b) => visitsClash(mine, b))) throw slotTaken();
}

function checkoutFor(b: BookingDoc, gateway: PaymentGateway) {
  return {
    keyId: gateway.keyId,
    orderId: b.payment.razorpayOrderId!,
    amount: b.totalPaise,
    currency: "INR" as const,
  };
}

export function toTrackedBooking(b: BookingDoc): TrackedBooking {
  return {
    number: b.number,
    firstName: b.customer.name.trim().split(/\s+/)[0] ?? "",
    city: b.city,
    serviceName: b.serviceName,
    addonNames: b.addons.map((a) => a.name),
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    minutes: b.minutes,
    totalPaise: b.totalPaise,
    status: b.status,
    paymentMethod: b.payment.method,
    paymentStatus: b.payment.status,
  };
}

export async function confirmBooking(
  input: CreateBookingRequest & { notes: string; paymentMethod: BookingPaymentMethod },
  deps: BookingDeps,
): Promise<BookingConfirmation> {
  const prefix = prefixOf(deps);
  const online = input.paymentMethod === "online";
  if (online && !deps.gateway) {
    throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Online payment is not available right now");
  }
  const hold = await readHold(input.holdToken, deps);
  if (!hold || hold.consumed) {
    throw new HttpError(409, "HOLD_EXPIRED", "Your held time has expired. Please pick a time again.");
  }
  const pinCity = visitCityForPincode(input.pincode);
  if (pinCity !== hold.city) {
    throw new HttpError(400, "PINCODE_NOT_COVERED", `That pincode is not in ${hold.city}`, { city: pinCity });
  }
  // Claim the hold before writing, so a double submit cannot create two bookings.
  const claimed = await deps.redis.eval(CONSUME, 1, holdKey(prefix, input.holdToken));
  if (claimed !== 1)
    throw new HttpError(409, "HOLD_EXPIRED", "Your held time has expired. Please pick a time again.");

  const startsAt = new Date(hold.startsAt);
  const endsAt = new Date(hold.endsAt);
  const number = await nextBookingNumber();
  const trackToken = randomBytes(24).toString("base64url");
  const status = online ? "pending_payment" : "confirmed";
  let booking!: BookingDoc;

  try {
    await mongoose.connection.transaction(async (session) => {
      await assertTechnicianFree(hold.techId, { startsAt, endsAt, city: hold.city }, session);
      const [b] = await Booking.create(
        [
          {
            number,
            customer: input.customer,
            city: hold.city,
            pincode: input.pincode,
            address: input.address,
            serviceId: hold.serviceId,
            serviceName: hold.serviceName,
            addons: hold.addons,
            totalPaise: hold.totalPaise,
            minutes: hold.minutes,
            technicianId: hold.techId,
            startsAt,
            endsAt,
            status,
            payment: { method: input.paymentMethod, status: online ? "pending" : "due" },
            trackTokenHash: sha256(trackToken),
            notes: input.notes,
            events: [{ status, at: new Date() }],
          },
        ],
        { session },
      );
      booking = b!;
    });
  } catch (err) {
    const taken =
      (err as { code?: number }).code === 11000 || (err instanceof HttpError && err.code === "SLOT_TAKEN");
    if (!taken) await deps.redis.eval(UNCONSUME, 1, holdKey(prefix, input.holdToken)).catch(() => undefined);
    // The partial unique index is the last line of defence against double booking.
    if (taken) throw slotTaken();
    throw err;
  }

  let razorpay: BookingConfirmation["razorpay"];
  if (online) {
    try {
      const rzp = await deps.gateway!.createOrder({
        amountPaise: booking.totalPaise,
        receipt: number,
        notes: { kind: "booking", bookingId: booking.id, bookingNumber: number },
      });
      booking.payment.razorpayOrderId = rzp.id;
      await booking.save();
      razorpay = checkoutFor(booking, deps.gateway!);
    } catch (err) {
      deps.log.error({ err, booking: number }, "razorpay order create failed; cancelling booking");
      await cancelUnpaidBooking(booking.id, "Payment gateway unavailable");
      throw new HttpError(502, "PAYMENT_GATEWAY_ERROR", "Could not start the payment. Please try again.");
    }
    await deps.jobs.scheduleBookingExpiry(booking.id, BOOKING_PAYMENT_TIMEOUT_MS).catch((err) => {
      deps.log.error({ err, booking: number }, "could not schedule booking expiry");
    });
  } else {
    await deps.jobs.notify({ type: "booking_confirmed", bookingId: booking.id }).catch((err) => {
      deps.log.error({ err, booking: number }, "could not enqueue booking notification");
    });
  }

  return { ...toTrackedBooking(booking), trackToken, ...(razorpay ? { razorpay } : {}) };
}

export async function findBooking({ number, token }: BookingAccess): Promise<BookingDoc> {
  const b = await Booking.findOne({ number });
  const ok = !!b && timingSafeEqual(Buffer.from(b.trackTokenHash, "hex"), Buffer.from(sha256(token), "hex"));
  // Same answer for a wrong number and a wrong token, so numbers cannot be probed.
  if (!b || !ok) throw new HttpError(404, "BOOKING_NOT_FOUND", "We could not find that booking");
  return b;
}

/** Checkout details to retry payment on a visit still awaiting it. */
export async function resumeBookingPayment(access: BookingAccess, deps: BookingDeps) {
  const b = await findBooking(access);
  if (b.status !== "pending_payment" || !b.payment.razorpayOrderId || !deps.gateway) {
    throw new HttpError(409, "BOOKING_NOT_PAYABLE", "This booking is not awaiting payment");
  }
  return { number: b.number, razorpay: checkoutFor(b, deps.gateway) };
}

/** Switches an unpaid online booking to "pay after the visit" and confirms it. */
export async function payBookingLater(access: BookingAccess, deps: BookingDeps): Promise<TrackedBooking> {
  const b = await findBooking(access);
  if (b.status !== "pending_payment") {
    throw new HttpError(409, "BOOKING_NOT_PAYABLE", "This booking is not awaiting payment");
  }
  b.status = "confirmed";
  b.payment.method = "after_visit";
  b.payment.status = "due";
  b.events.push({ status: "confirmed", at: new Date(), note: "Customer chose to pay after the visit" });
  await b.save();
  await deps.jobs.notify({ type: "booking_confirmed", bookingId: b.id }).catch((err) => {
    deps.log.error({ err, booking: b.number }, "could not enqueue booking notification");
  });
  return toTrackedBooking(b);
}

/** Cancels a booking still awaiting payment, freeing its slot. No-op otherwise. */
export async function cancelUnpaidBooking(bookingId: string, note: string): Promise<boolean> {
  const res = await Booking.updateOne(
    { _id: bookingId, status: "pending_payment" },
    { $set: { status: "cancelled" }, $push: { events: { status: "cancelled", at: new Date(), note } } },
  );
  return res.modifiedCount === 1;
}

export interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  error_description?: string;
}

export type BookingPaymentOutcome =
  "placed" | "already_final" | "payment_failed" | "amount_mismatch" | "needs_refund";

/**
 * Applies a verified Razorpay payment to a booking, inside the webhook's transaction.
 * A payment that lands after the booking expired re-confirms it if the technician is still free;
 * otherwise the money is recorded and the booking flagged for a refund, never double-booked.
 */
export async function applyBookingPayment(
  booking: BookingDoc,
  event: string,
  payment: RazorpayPaymentEntity,
  session: ClientSession,
): Promise<BookingPaymentOutcome> {
  if (event === "payment.failed") {
    if (booking.payment.status === "captured") return "already_final";
    booking.payment.status = "failed";
    booking.payment.failureReason = payment.error_description?.slice(0, 200);
    await booking.save({ session });
    return "payment_failed";
  }
  if (payment.amount !== booking.totalPaise) return "amount_mismatch";
  if (booking.payment.status === "captured") return "already_final";

  const now = new Date();
  booking.payment.method = "online";
  booking.payment.status = "captured";
  booking.payment.razorpayPaymentId = payment.id;
  booking.payment.paidAt = now;
  booking.payment.failureReason = undefined;

  let outcome: BookingPaymentOutcome = "placed";
  if (booking.status === "pending_payment") {
    booking.status = "confirmed";
    booking.events.push({ status: "confirmed", at: now, note: "Paid online" });
  } else if (booking.status === "cancelled") {
    try {
      await assertTechnicianFree(
        String(booking.technicianId),
        { startsAt: booking.startsAt, endsAt: booking.endsAt, city: booking.city },
        session,
        booking.id,
      );
      booking.status = "confirmed";
      booking.events.push({
        status: "confirmed",
        at: now,
        note: "Paid after the payment window closed; slot still free",
      });
    } catch {
      booking.events.push({
        status: "cancelled",
        at: now,
        note: "Paid after the payment window closed but the slot was taken: refund needed",
      });
      outcome = "needs_refund";
    }
  } else {
    // Already confirmed (e.g. switched to pay-after, then paid anyway): just record the payment.
    booking.events.push({ status: booking.status, at: now, note: "Paid online" });
    outcome = "already_final";
  }
  await booking.save({ session });
  return outcome;
}
