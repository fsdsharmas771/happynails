import {
  addIstDays,
  availabilityQuerySchema,
  bookingAccessSchema,
  bookingPaymentVerifySchema,
  BOOKING_HORIZON_DAYS,
  createBookingRequestSchema,
  daysOfMonth,
  holdRequestSchema,
  istDateOf,
  pincodeCheckRequestSchema,
  visitCityForPincode,
  visitCitySchema,
  type AvailabilityResponse,
  type ServicesResponse,
} from "@happynails/shared";
import { Router } from "express";
import { z } from "zod";
import {
  computeSlots,
  confirmBooking,
  findBooking,
  loadSelection,
  payBookingLater,
  placeHold,
  releaseHold,
  resumeBookingPayment,
  toTrackedBooking,
  type BookingDeps,
} from "../bookings/engine";
import { HttpError } from "../errors";
import { toInvoiceDto } from "../invoices/service";
import { Invoice } from "../models/Invoice";
import { Addon, Booking, Service } from "../models/Booking";

export function servicesRouter(deps: Pick<BookingDeps, "gateway">): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const [services, addons] = await Promise.all([
      Service.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      Addon.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    ]);
    const body: ServicesResponse = {
      services: services.map((s) => ({
        id: String(s._id),
        name: s.name,
        description: s.description,
        minutes: s.minutes,
        pricePaise: s.pricePaise,
      })),
      addons: addons.map((a) => ({
        id: String(a._id),
        name: a.name,
        description: a.description,
        minutes: a.minutes,
        pricePaise: a.pricePaise,
        ...(a.unitNote ? { unitNote: a.unitNote } : {}),
      })),
      onlinePaymentAvailable: !!deps.gateway,
    };
    res.json(body);
  });
  return router;
}

export function availabilityRouter(deps: BookingDeps): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const q = availabilityQuerySchema.parse(req.query);
    const { minutes } = await loadSelection(q.serviceId, q.addonIds);
    const today = istDateOf(deps.now?.() ?? new Date());
    const last = addIstDays(today, BOOKING_HORIZON_DAYS);
    // Only days inside the booking window are computed; the rest of the month is simply closed.
    const all = daysOfMonth(q.month);
    const dates = all.filter((d) => d >= today && d <= last);
    const slots = await computeSlots(q.city, minutes, dates, deps);
    const body: AvailabilityResponse = {
      month: q.month,
      city: q.city,
      minutes,
      days: all.map((date) => {
        const list = (slots.get(date) ?? []).map((s) => ({
          time: s.time,
          startsAt: s.startsAt.toISOString(),
          open: s.freeTechIds.length > 0,
        }));
        return { date, openCount: list.filter((s) => s.open).length, slots: list };
      }),
    };
    res.set("Cache-Control", "no-store");
    res.json(body);
  });

  /** First open slot in a city for the shortest service: the hero's "next home visit" line. */
  router.get("/next", async (req, res) => {
    const city = visitCitySchema.parse(req.query.city);
    const shortest = await Service.findOne({ active: true }).sort({ minutes: 1 }).lean();
    let startsAt: string | null = null;
    if (shortest) {
      const today = istDateOf(deps.now?.() ?? new Date());
      // Look a fortnight at a time so a busy calendar does not mean one huge query.
      for (let offset = 0; offset <= BOOKING_HORIZON_DAYS && !startsAt; offset += 14) {
        const dates = Array.from({ length: 14 }, (_, i) => addIstDays(today, offset + i));
        const slots = await computeSlots(city, shortest.minutes, dates, deps);
        for (const date of dates) {
          const open = slots.get(date)?.find((s) => s.freeTechIds.length > 0);
          if (open) {
            startsAt = open.startsAt.toISOString();
            break;
          }
        }
      }
    }
    res.set("Cache-Control", "no-store");
    res.json({ city, startsAt });
  });

  return router;
}

export function bookingsRouter(deps: BookingDeps): Router {
  const router = Router();

  router.post("/hold", async (req, res) => {
    const input = holdRequestSchema.parse(req.body);
    res.status(201).json(await placeHold(input, deps));
  });

  router.delete("/hold/:token", async (req, res) => {
    const token = z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,64}$/)
      .safeParse(req.params.token);
    if (token.success) await releaseHold(token.data, deps);
    res.status(204).end();
  });

  router.post("/", async (req, res) => {
    const input = createBookingRequestSchema.parse(req.body);
    res.status(201).json(await confirmBooking(input, deps));
  });

  router.get("/track", async (req, res) => {
    const access = bookingAccessSchema.safeParse(req.query);
    if (!access.success) throw new HttpError(404, "BOOKING_NOT_FOUND", "We could not find that booking");
    res.set("Cache-Control", "no-store");
    const booking = await findBooking(access.data);
    const invoice = await Invoice.findOne({
      kind: "invoice",
      "source.type": "booking",
      "source.id": booking._id,
    }).lean();
    res.json({ ...toTrackedBooking(booking), ...(invoice ? { invoiceNumber: invoice.number } : {}) });
  });

  router.get("/invoice", async (req, res) => {
    const access = bookingAccessSchema.safeParse(req.query);
    if (!access.success) throw new HttpError(404, "BOOKING_NOT_FOUND", "We could not find that booking");
    const booking = await findBooking(access.data);
    const docs = await Invoice.find({ "source.type": "booking", "source.id": booking._id })
      .sort({ issuedAt: 1 })
      .lean();
    if (!docs.length)
      throw new HttpError(404, "INVOICE_NOT_READY", "The invoice is issued once the visit is paid");
    res.set("Cache-Control", "no-store");
    res.json(docs.map(toInvoiceDto));
  });

  /** Retry online payment for a booking still awaiting it. */
  router.post("/pay", async (req, res) => {
    res.json(await resumeBookingPayment(bookingAccessSchema.parse(req.body), deps));
  });

  /** Give up on paying online and pay after the visit instead. */
  router.post("/pay-later", async (req, res) => {
    res.json(await payBookingLater(bookingAccessSchema.parse(req.body), deps));
  });

  /** Checkout success callback: lets the page say "payment received". Only the webhook confirms. */
  router.post("/verify-payment", async (req, res) => {
    const body = bookingPaymentVerifySchema.parse(req.body);
    if (!deps.gateway) throw new HttpError(503, "PAYMENTS_UNAVAILABLE", "Online payment is not available");
    const b = await Booking.findOne({ number: body.number }).lean();
    const valid =
      !!b &&
      b.payment.razorpayOrderId === body.razorpay_order_id &&
      deps.gateway.verifyPaymentSignature(
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
      );
    if (!valid) throw new HttpError(400, "SIGNATURE_INVALID", "Payment could not be verified");
    res.json({ verified: true, status: b.status });
  });

  return router;
}

export function pincodeRouter(): Router {
  const router = Router();
  router.post("/check", (req, res) => {
    const { pincode } = pincodeCheckRequestSchema.parse(req.body);
    const city = visitCityForPincode(pincode);
    res.json({ covered: city !== null, city });
  });
  return router;
}
