import { randomBytes, createHash } from "node:crypto";
import { addIstDays, istToUtc, type BookingStatus, type VisitCity } from "@happynails/shared";
import mongoose from "mongoose";
import { HttpError } from "../errors";
import { Booking, Technician, type BookingDoc } from "../models/Booking";
import { assertTechnicianFree, loadSelection, nextBookingNumber, type BookingDeps } from "./engine";

async function load(id: string): Promise<BookingDoc> {
  const b = mongoose.isValidObjectId(id) ? await Booking.findById(id) : null;
  if (!b) throw new HttpError(404, "BOOKING_NOT_FOUND", "No such booking");
  return b;
}
export const getBooking = load;

export async function listBookings(q: {
  from: string;
  to: string;
  city?: VisitCity | undefined;
  technicianId?: string | undefined;
  status?: BookingStatus | undefined;
}) {
  const filter: Record<string, unknown> = {
    startsAt: { $gte: istToUtc(q.from, "00:00"), $lt: istToUtc(addIstDays(q.to, 1), "00:00") },
  };
  if (q.city) filter.city = q.city;
  if (q.technicianId) filter.technicianId = q.technicianId;
  if (q.status) filter.status = q.status;
  return Booking.find(filter).sort({ startsAt: 1 }).limit(1000).lean();
}

/** Picks a technician for a hand-made booking: the one asked for, or the first free one. */
async function chooseTechnician(
  city: VisitCity,
  visit: { startsAt: Date; endsAt: Date },
  requested: string | undefined,
  session: mongoose.ClientSession,
  ignoreBookingId?: string,
): Promise<string> {
  const candidates = requested
    ? await Technician.find({ _id: requested, active: true, cities: city }).session(session).lean()
    : await Technician.find({ active: true, cities: city }).sort({ _id: 1 }).session(session).lean();
  if (requested && !candidates.length) {
    throw new HttpError(
      409,
      "TECHNICIAN_UNAVAILABLE",
      `That technician does not cover ${city} or is inactive`,
    );
  }
  for (const t of candidates) {
    try {
      await assertTechnicianFree(String(t._id), { ...visit, city }, session, ignoreBookingId);
      return String(t._id);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  throw new HttpError(
    409,
    "SLOT_TAKEN",
    requested
      ? "That technician is busy then, including travel time between visits"
      : "No technician is free then, including travel time between visits",
  );
}

/**
 * A booking made by the team (phone or WhatsApp customers). Same travel-gap rules as the website;
 * the 3 hour lead time and working hours are not enforced, so the owner can fit people in.
 */
export async function createManualBooking(
  input: {
    city: VisitCity;
    pincode: string;
    address: string;
    customer: { name: string; phone: string };
    serviceId: string;
    addonIds: string[];
    startsAt: string;
    technicianId?: string | undefined;
    notes: string;
  },
  by: string,
  deps: BookingDeps,
): Promise<BookingDoc> {
  const sel = await loadSelection(input.serviceId, input.addonIds);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + sel.minutes * 60_000);
  const number = await nextBookingNumber();
  // Phone bookings get a token too, so the record is complete; the team can share the number.
  const trackTokenHash = createHash("sha256").update(randomBytes(24).toString("base64url")).digest("hex");
  let id = "";
  try {
    await mongoose.connection.transaction(async (session) => {
      const technicianId = await chooseTechnician(
        input.city,
        { startsAt, endsAt },
        input.technicianId,
        session,
      );
      const [b] = await Booking.create(
        [
          {
            number,
            customer: input.customer,
            city: input.city,
            pincode: input.pincode,
            address: input.address,
            serviceId: sel.serviceId,
            serviceName: sel.serviceName,
            addons: sel.addons,
            totalPaise: sel.totalPaise,
            minutes: sel.minutes,
            technicianId,
            startsAt,
            endsAt,
            status: "confirmed",
            payment: { method: "after_visit", status: "due" },
            trackTokenHash,
            notes: input.notes,
            events: [{ status: "confirmed", at: new Date(), note: `Booked by ${by}` }],
          },
        ],
        { session },
      );
      id = b!.id;
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, "SLOT_TAKEN", "That technician already has a booking then");
    }
    throw err;
  }
  await deps.jobs.notify({ type: "booking_confirmed", bookingId: id }).catch(() => undefined);
  return load(id);
}

export async function rescheduleBooking(
  id: string,
  input: { startsAt: string; technicianId?: string | undefined },
  by: string,
  deps: BookingDeps,
): Promise<BookingDoc> {
  const existing = await load(id);
  if (!["confirmed", "pending_payment"].includes(existing.status)) {
    throw new HttpError(409, "BAD_TRANSITION", `A ${existing.status} booking cannot be rescheduled`);
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + existing.minutes * 60_000);
  try {
    await mongoose.connection.transaction(async (session) => {
      const b = await Booking.findById(id).session(session);
      const technicianId = await chooseTechnician(
        b!.city,
        { startsAt, endsAt },
        input.technicianId ?? String(b!.technicianId),
        session,
        id,
      );
      b!.technicianId = new mongoose.Types.ObjectId(technicianId);
      b!.startsAt = startsAt;
      b!.endsAt = endsAt;
      b!.reminderSentAt = undefined;
      b!.events.push({ status: b!.status, at: new Date(), note: `Rescheduled by ${by}` });
      await b!.save({ session });
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, "SLOT_TAKEN", "That technician already has a booking then");
    }
    throw err;
  }
  // The confirmation message carries the new time.
  await deps.jobs.notify({ type: "booking_confirmed", bookingId: id }).catch(() => undefined);
  return load(id);
}

const ALLOWED: Record<"cancel" | "complete" | "no_show", BookingStatus[]> = {
  cancel: ["confirmed", "pending_payment"],
  complete: ["confirmed"],
  no_show: ["confirmed"],
};

export async function setBookingOutcome(
  id: string,
  action: "cancel" | "complete" | "no_show",
  note: string,
  by: string,
  deps: BookingDeps,
): Promise<BookingDoc> {
  const b = await load(id);
  if (!ALLOWED[action].includes(b.status)) {
    throw new HttpError(
      409,
      "BAD_TRANSITION",
      `A ${b.status} booking cannot be marked ${action.replace("_", "-")}`,
    );
  }
  const status: BookingStatus =
    action === "cancel" ? "cancelled" : action === "complete" ? "completed" : "no_show";
  const refundNote =
    action === "cancel" && b.payment.status === "captured" ? "; paid online, refund needed" : "";
  b.status = status;
  b.events.push({ status, at: new Date(), note: `${note || "No note"} (${by})${refundNote}` });
  await b.save();
  if (action === "cancel") {
    await deps.jobs.notify({ type: "booking_cancelled", bookingId: b.id }).catch(() => undefined);
  }
  return b;
}

/** Records a pay-after-visit payment collected by UPI or cash. */
export async function markBookingPaid(id: string, by: string): Promise<BookingDoc> {
  const b = await load(id);
  if (b.payment.method !== "after_visit" || b.payment.status !== "due") {
    throw new HttpError(
      409,
      "BAD_TRANSITION",
      "Only a visit with payment due after the visit can be marked paid",
    );
  }
  b.payment.status = "paid_after_visit";
  b.payment.paidAt = new Date();
  b.events.push({ status: b.status, at: new Date(), note: `Payment collected after the visit (${by})` });
  await b.save();
  return b;
}

export async function refundBooking(
  id: string,
  input: { amountPaise?: number | undefined; reason: string },
  by: string,
  deps: BookingDeps,
): Promise<BookingDoc> {
  const b = await load(id);
  if (!deps.gateway) throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Razorpay is not configured");
  if (b.payment.status !== "captured" || !b.payment.razorpayPaymentId) {
    throw new HttpError(409, "NOT_REFUNDABLE", "Only visits paid online can be refunded");
  }
  const refunded = b.refunds.reduce((s, r) => s + r.amountPaise, 0);
  const left = b.totalPaise - refunded;
  const amount = input.amountPaise ?? left;
  if (amount <= 0 || amount > left)
    throw new HttpError(400, "BAD_AMOUNT", `You can refund up to ${left} paise`);
  const r = await deps.gateway.refund({
    paymentId: b.payment.razorpayPaymentId,
    amountPaise: amount,
    notes: { bookingNumber: b.number, reason: input.reason.slice(0, 200) },
  });
  const now = new Date();
  b.refunds.push({ razorpayRefundId: r.id, amountPaise: r.amountPaise, reason: input.reason, at: now });
  if (refunded + r.amountPaise >= b.totalPaise) b.payment.status = "refunded";
  b.events.push({
    status: b.status,
    at: now,
    note: `Refunded ${r.amountPaise} paise: ${input.reason} (${by})`,
  });
  await b.save();
  return b;
}
