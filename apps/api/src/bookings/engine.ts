import { randomBytes } from "node:crypto";
import {
  addIstDays,
  BOOKING_HORIZON_DAYS,
  BOOKING_MIN_LEAD_MS,
  HOLD_TTL_SECONDS,
  istDateOf,
  istTimeOf,
  istToUtc,
  istWeekday,
  visitCityForPincode,
  type BookingConfirmation,
  type CreateBookingRequest,
  type HoldResponse,
  type IstDate,
  type IstTime,
  type VisitCity,
} from "@happynails/shared";
import type { Redis } from "ioredis";
import mongoose, { type Types } from "mongoose";
import type { Logger } from "pino";
import { HttpError } from "../errors";
import type { Jobs } from "../jobs/types";
import { Counter } from "../models/Order";
import { Addon, AvailabilityBlock, AvailabilityRule, Booking, Service, Technician } from "../models/Booking";

export interface BookingDeps {
  redis: Redis;
  jobs: Jobs;
  log: Logger;
  /** Namespace for Redis keys; tests use their own. */
  keyPrefix?: string;
  now?: () => Date;
}

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

/** Grid starts a visit beginning at `time` would occupy: every start in [start, start + minutes). */
function coveredTimes(day: TechDay, time: IstTime, minutes: number): IstTime[] {
  const start = istToUtc(day.date, time).getTime();
  const end = start + minutes * 60_000;
  return day.grid.filter((t) => {
    const at = istToUtc(day.date, t).getTime();
    return at >= start && at < end;
  });
}

const slotKey = (prefix: string, techId: string, startsAt: Date) =>
  `${prefix}hold:slot:${techId}:${startsAt.toISOString()}`;
const tokenKey = (prefix: string, token: string) => `${prefix}hold:token:${token}`;

export interface SlotCandidate {
  date: IstDate;
  time: IstTime;
  startsAt: Date;
  /** Technicians free for the whole visit, in assignment order. */
  freeTechIds: string[];
}

/** Bookable window: at least 3 hours from now and within 90 days. */
function inWindow(startsAt: Date, now: Date): boolean {
  const t = startsAt.getTime();
  return t >= now.getTime() + BOOKING_MIN_LEAD_MS && t <= now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000;
}

/**
 * Open slots for a city and visit length over some days: rules minus blocks, minus confirmed
 * bookings, minus live holds, limited to technicians covering the city.
 */
export async function computeSlots(
  city: VisitCity,
  minutes: number,
  dates: IstDate[],
  deps: Pick<BookingDeps, "redis" | "keyPrefix" | "now">,
): Promise<Map<IstDate, { time: IstTime; startsAt: Date; freeTechIds: string[] }[]>> {
  const now = deps.now?.() ?? new Date();
  const prefix = deps.keyPrefix ?? "hn:";
  const techs = await techsFor(city);
  const days = await schedules(
    techs.map((t) => t._id),
    dates,
  );

  const result = new Map<IstDate, Map<IstTime, { time: IstTime; startsAt: Date; freeTechIds: string[] }>>();
  for (const date of dates) result.set(date, new Map());
  if (!days.length) return new Map([...result].map(([d, m]) => [d, [...m.values()]]));

  const from = istToUtc(dates[0]!, "00:00");
  const to = istToUtc(addIstDays(dates[dates.length - 1]!, 1), "23:59");
  const bookings = await Booking.find({
    technicianId: { $in: techs.map((t) => t._id) },
    status: "confirmed",
    startsAt: { $lt: to },
    endsAt: { $gt: from },
  })
    .select({ technicianId: 1, startsAt: 1, endsAt: 1 })
    .lean();

  // Every (technician, start) a candidate might need; fetch their hold keys in one round trip.
  const keys = new Set<string>();
  for (const day of days) {
    for (const t of day.grid) keys.add(slotKey(prefix, day.techId, istToUtc(day.date, t)));
  }
  const keyList = [...keys];
  const values = keyList.length ? await deps.redis.mget(keyList) : [];
  const held = new Set(keyList.filter((_, i) => values[i] !== null));

  for (const day of days) {
    const forDay = result.get(day.date)!;
    for (const time of day.grid) {
      const startsAt = istToUtc(day.date, time);
      const slot = forDay.get(time) ?? { time, startsAt, freeTechIds: [] };
      forDay.set(time, slot);
      if (!inWindow(startsAt, now)) continue;
      const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
      const clashes = bookings.some(
        (b) => String(b.technicianId) === day.techId && b.startsAt < endsAt && b.endsAt > startsAt,
      );
      if (clashes) continue;
      const anyHeld = coveredTimes(day, time, minutes).some((t) =>
        held.has(slotKey(prefix, day.techId, istToUtc(day.date, t))),
      );
      if (!anyHeld) slot.freeTechIds.push(day.techId);
    }
  }

  return new Map(
    [...result].map(([date, m]) => [date, [...m.values()].sort((a, b) => a.time.localeCompare(b.time))]),
  );
}

// ---------- holds ----------

// Atomically claims every slot key (all or none) and stores the hold under the token key.
const ACQUIRE = `
for i = 1, #KEYS - 1 do
  if redis.call('EXISTS', KEYS[i]) == 1 then return 0 end
end
for i = 1, #KEYS - 1 do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2])
end
redis.call('SET', KEYS[#KEYS], ARGV[3], 'EX', ARGV[2])
return 1`;

// Releases only keys still owned by this token.
const RELEASE = `
for i = 1, #KEYS - 1 do
  if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]) end
end
redis.call('DEL', KEYS[#KEYS])
return 1`;

interface HoldRecord extends Selection {
  techId: string;
  city: VisitCity;
  startsAt: string;
  endsAt: string;
  keys: string[];
}

export async function placeHold(
  input: { city: VisitCity; serviceId: string; addonIds: string[]; startsAt: string },
  deps: BookingDeps,
): Promise<HoldResponse> {
  const prefix = deps.keyPrefix ?? "hn:";
  const now = deps.now?.() ?? new Date();
  const selection = await loadSelection(input.serviceId, input.addonIds);
  const startsAt = new Date(input.startsAt);
  const taken = () => new HttpError(409, "SLOT_TAKEN", "That time has just been taken. Please pick another.");
  if (!inWindow(startsAt, now)) throw taken();

  const date = istDateOf(startsAt);
  const time = istTimeOf(startsAt);
  const slots = await computeSlots(input.city, selection.minutes, [date], deps);
  const slot = slots.get(date)?.find((s) => s.time === time);
  if (!slot || slot.startsAt.getTime() !== startsAt.getTime()) throw taken();

  const days = await schedules(
    slot.freeTechIds.map((id) => new mongoose.Types.ObjectId(id)),
    [date],
  );
  const endsAt = new Date(startsAt.getTime() + selection.minutes * 60_000);
  const token = randomBytes(24).toString("base64url");

  // First free technician whose slots we can claim atomically wins.
  for (const techId of slot.freeTechIds) {
    const day = days.find((d) => d.techId === techId);
    if (!day) continue;
    const keys = coveredTimes(day, time, selection.minutes).map((t) =>
      slotKey(prefix, techId, istToUtc(date, t)),
    );
    const record: HoldRecord = {
      ...selection,
      techId,
      city: input.city,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      keys,
    };
    const ok = await deps.redis.eval(
      ACQUIRE,
      keys.length + 1,
      ...keys,
      tokenKey(prefix, token),
      token,
      String(HOLD_TTL_SECONDS),
      JSON.stringify(record),
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
  throw taken();
}

async function readHold(token: string, deps: BookingDeps): Promise<HoldRecord | null> {
  const raw = await deps.redis.get(tokenKey(deps.keyPrefix ?? "hn:", token));
  return raw ? (JSON.parse(raw) as HoldRecord) : null;
}

export async function releaseHold(token: string, deps: BookingDeps): Promise<void> {
  const hold = await readHold(token, deps);
  if (!hold) return;
  await deps.redis.eval(
    RELEASE,
    hold.keys.length + 1,
    ...hold.keys,
    tokenKey(deps.keyPrefix ?? "hn:", token),
    token,
  );
}

// ---------- confirmation ----------

export async function nextBookingNumber(now = new Date()): Promise<string> {
  const yy = istDateOf(now).slice(2, 4);
  const c = await Counter.findOneAndUpdate(
    { _id: `booking-${yy}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return `HN-V${yy}${String(c!.seq).padStart(4, "0")}`;
}

export async function confirmBooking(
  input: CreateBookingRequest & { notes: string },
  deps: BookingDeps,
): Promise<BookingConfirmation> {
  const hold = await readHold(input.holdToken, deps);
  if (!hold) {
    throw new HttpError(409, "HOLD_EXPIRED", "Your held time has expired. Please pick a time again.");
  }
  const pinCity = visitCityForPincode(input.pincode);
  if (pinCity !== hold.city) {
    throw new HttpError(400, "PINCODE_NOT_COVERED", `That pincode is not in ${hold.city}`, { city: pinCity });
  }

  const startsAt = new Date(hold.startsAt);
  const endsAt = new Date(hold.endsAt);
  const number = await nextBookingNumber();
  const now = new Date();
  let bookingId = "";

  try {
    await mongoose.connection.transaction(async (session) => {
      const clash = await Booking.exists({
        technicianId: hold.techId,
        status: "confirmed",
        startsAt: { $lt: endsAt },
        endsAt: { $gt: startsAt },
      }).session(session);
      if (clash)
        throw new HttpError(409, "SLOT_TAKEN", "That time has just been taken. Please pick another.");
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
            status: "confirmed",
            notes: input.notes,
            events: [{ status: "confirmed", at: now }],
          },
        ],
        { session },
      );
      bookingId = b!.id;
    });
  } catch (err) {
    // The partial unique index is the last line of defence against double booking.
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, "SLOT_TAKEN", "That time has just been taken. Please pick another.");
    }
    throw err;
  }

  await releaseHold(input.holdToken, deps);
  await deps.jobs.notify({ type: "booking_confirmed", bookingId }).catch((err) => {
    deps.log.error({ err, booking: number }, "could not enqueue booking notification");
  });

  return {
    number,
    firstName: input.customer.name.trim().split(/\s+/)[0] ?? "",
    city: hold.city,
    serviceName: hold.serviceName,
    addonNames: hold.addons.map((a) => a.name),
    startsAt: hold.startsAt,
    endsAt: hold.endsAt,
    minutes: hold.minutes,
    totalPaise: hold.totalPaise,
  };
}
