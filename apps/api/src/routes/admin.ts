import {
  addIstDays,
  adminBookingCreateSchema,
  adminBookingQuerySchema,
  adminLoginSchema,
  adminOrderQuerySchema,
  adminProductInputSchema,
  blockInputSchema,
  calendarDaySchema,
  calendarQuerySchema,
  IST_DATE,
  IST_MONTH,
  daysOfMonth,
  cancelSchema,
  istDateOf,
  istToUtc,
  offeringInputSchema,
  orderStatusChangeSchema,
  refundSchema,
  reorderSchema,
  rescheduleSchema,
  stockAdjustSchema,
  technicianInputSchema,
  testimonialInputSchema,
  trackingSchema,
  weeklyHoursSchema,
} from "@happynails/shared";
import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import multer from "multer";
import { z } from "zod";
import {
  checkCredentials,
  clearSession,
  issueSession,
  requireAdmin,
  requireAdminHeader,
  requireOwner,
  type AdminAuthConfig,
} from "../admin/auth";
import {
  createManualBooking,
  getBooking,
  listBookings,
  markBookingPaid,
  refundBooking,
  rescheduleBooking,
  setBookingOutcome,
} from "../bookings/admin";
import type { BookingDeps } from "../bookings/engine";
import { HttpError } from "../errors";
import { Testimonial } from "../models/Admin";
import {
  Addon,
  AvailabilityBlock,
  AvailabilityOverride,
  AvailabilityRule,
  Booking,
  Service,
  Technician,
} from "../models/Booking";
import { effectiveDays } from "../bookings/engine";
import { gstCsv, gstReport } from "../invoices/report";
import { toInvoiceDto } from "../invoices/service";
import { Invoice } from "../models/Invoice";
import { Order } from "../models/Order";
import { Product } from "../models/Product";
import {
  cancelOrder,
  changeOrderStatus,
  getOrder,
  listOrders,
  refundOrder,
  setTracking,
  shipWithShiprocket,
} from "../orders/admin";
import type { ShippingProvider } from "../shipping/shiprocket";
import type { OrderDeps } from "../orders/service";
import { sniff, UPLOAD_LIMITS, type UploadKind, type UploadProvider } from "../uploads/provider";

export interface AdminDeps {
  auth: AdminAuthConfig;
  orders: OrderDeps;
  bookings: BookingDeps;
  uploads: UploadProvider;
  shipping: ShippingProvider | null;
}

const who = (req: Request) => req.admin!.name || req.admin!.email;
const idParam = (req: Request) => {
  const id = String(req.params.id ?? "");
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "NOT_FOUND", "No such record");
  return id;
};

/**
 * Validates an edit: only the fields actually sent are returned. Without this, schema defaults
 * (active: true, images: [], description: "") would silently overwrite fields the edit did not touch.
 */
function parsePatch<T extends z.ZodObject>(schema: T, body: unknown): Partial<z.infer<T>> {
  const parsed = schema.partial().parse(body) as Record<string, unknown>;
  const sent = new Set(Object.keys(body && typeof body === "object" ? body : {}));
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as Partial<z.infer<T>>;
}

async function found<T>(p: Promise<T | null>, what = "record"): Promise<T> {
  const v = await p;
  if (!v) throw new HttpError(404, "NOT_FOUND", `No such ${what}`);
  return v;
}

export function adminRouter(deps: AdminDeps): Router {
  const router = Router();
  router.use(requireAdminHeader);

  // ---------- auth ----------
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    // Only failed attempts count, so signing in often never locks the owner out.
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: () => {
      throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many sign-in attempts. Try again in 15 minutes.");
    },
  });

  router.post("/auth/login", loginLimiter, async (req, res) => {
    const { email, password } = adminLoginSchema.parse(req.body);
    const user = await checkCredentials(email, password);
    if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "That email and password do not match");
    user.lastLoginAt = new Date();
    await user.save();
    await issueSession(res, user, deps.auth);
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  router.post("/auth/logout", (_req, res) => {
    clearSession(res, deps.auth);
    res.status(204).end();
  });

  // Everything below needs a signed-in admin.
  router.use(requireAdmin(deps.auth));

  router.get("/auth/me", (req, res) => {
    res.json(req.admin);
  });

  // ---------- dashboard ----------
  router.get("/dashboard", async (_req, res) => {
    const today = istDateOf(new Date());
    const monthStart = istToUtc(`${today.slice(0, 7)}-01`, "00:00");
    const [visits, toPack, orderRevenue, bookingRevenue, needsRefund] = await Promise.all([
      Booking.find({
        status: { $in: ["confirmed", "pending_payment"] },
        startsAt: { $gte: istToUtc(today, "00:00"), $lt: istToUtc(addIstDays(today, 1), "00:00") },
      })
        .sort({ startsAt: 1 })
        .select({
          number: 1,
          startsAt: 1,
          city: 1,
          serviceName: 1,
          customer: 1,
          technicianId: 1,
          status: 1,
          payment: 1,
        })
        .lean(),
      Order.find({ status: "placed" })
        .sort({ createdAt: 1 })
        .limit(10)
        .select({ number: 1, customer: 1, totalPaise: 1, createdAt: 1 })
        .lean(),
      Order.aggregate<{ total: number; refunded: number }>([
        {
          $match: {
            "payment.status": { $in: ["captured", "refunded"] },
            "payment.paidAt": { $gte: monthStart },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalPaise" },
            refunded: { $sum: { $sum: "$refunds.amountPaise" } },
          },
        },
      ]),
      Booking.aggregate<{ total: number; refunded: number }>([
        {
          $match: {
            "payment.status": { $in: ["captured", "paid_after_visit", "refunded"] },
            "payment.paidAt": { $gte: monthStart },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalPaise" },
            refunded: { $sum: { $sum: "$refunds.amountPaise" } },
          },
        },
      ]),
      Promise.all([
        Booking.countDocuments({ status: "cancelled", "payment.status": "captured" }),
        Order.countDocuments({ status: "cancelled", "payment.status": "captured" }),
      ]),
    ]);
    const net = (r: { total: number; refunded: number }[]) => (r[0] ? r[0].total - r[0].refunded : 0);
    const techs = await Technician.find({ _id: { $in: visits.map((v) => v.technicianId) } })
      .select({ name: 1 })
      .lean();
    res.json({
      today,
      visits: visits.map((v) => ({
        id: String(v._id),
        number: v.number,
        startsAt: v.startsAt,
        city: v.city,
        serviceName: v.serviceName,
        customerName: v.customer.name,
        technician: techs.find((t) => t._id.equals(v.technicianId))?.name ?? "",
        status: v.status,
        paymentStatus: v.payment.status,
      })),
      ordersToPack: { count: await Order.countDocuments({ status: "placed" }), oldest: toPack },
      revenueThisMonthPaise: net(orderRevenue) + net(bookingRevenue),
      needsRefund: needsRefund[0] + needsRefund[1],
    });
  });

  // ---------- products ----------
  router.get("/products", async (_req, res) => {
    res.json(await Product.find().sort({ sortOrder: 1, createdAt: 1 }).lean());
  });

  router.post("/products", requireOwner, async (req, res) => {
    const input = adminProductInputSchema.parse(req.body);
    if (await Product.exists({ slug: input.slug }))
      throw new HttpError(409, "SLUG_TAKEN", "That web address is already used");
    const last = await Product.findOne().sort({ sortOrder: -1 }).select({ sortOrder: 1 }).lean();
    res.status(201).json(await Product.create({ ...input, sortOrder: (last?.sortOrder ?? 0) + 10 }));
  });

  router.patch("/products/:id", requireOwner, async (req, res) => {
    const input = parsePatch(adminProductInputSchema, req.body);
    if (input.slug && (await Product.exists({ slug: input.slug, _id: { $ne: idParam(req) } }))) {
      throw new HttpError(409, "SLUG_TAKEN", "That web address is already used");
    }
    const unset = "color2" in req.body && !input.color2 ? { $unset: { color2: 1 } } : {};
    const { color2: _c2, ...rest } = input;
    const doc = await found(
      Product.findByIdAndUpdate(
        idParam(req),
        { $set: { ...rest, ...(input.color2 ? { color2: input.color2 } : {}) }, ...unset },
        { new: true, runValidators: true },
      ),
      "product",
    );
    res.json(doc);
  });

  // Staff can count stock in and out; every change needs a reason.
  router.post("/products/:id/stock", async (req, res) => {
    const { delta, reason } = stockAdjustSchema.parse(req.body);
    const doc = await Product.findOneAndUpdate(
      { _id: idParam(req), ...(delta < 0 ? { stock: { $gte: -delta } } : {}) },
      { $inc: { stock: delta } },
      { new: true },
    );
    if (!doc) throw new HttpError(409, "STOCK_TOO_LOW", "Stock cannot go below zero");
    req.log.info({ product: doc.slug, delta, reason, by: who(req) }, "stock adjusted");
    res.json(doc);
  });

  router.post("/products/reorder", requireOwner, async (req, res) => {
    const { ids } = reorderSchema.parse(req.body);
    await Product.bulkWrite(
      ids.map((id, i) => ({
        updateOne: { filter: { _id: id }, update: { $set: { sortOrder: (i + 1) * 10 } } },
      })),
    );
    res.json(await Product.find().sort({ sortOrder: 1 }).lean());
  });

  // ---------- uploads ----------
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.video, files: 1 },
  });
  router.post(
    "/uploads",
    requireOwner,
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, "FILE_TOO_LARGE", "That file is too large"));
        }
        if (err) return next(err);
        next();
      });
    },
    async (req, res) => {
      const kind = z.enum(["image", "video"]).parse(req.query.kind) as UploadKind;
      const file = req.file;
      if (!file) throw new HttpError(400, "NO_FILE", "Choose a file to upload");
      const detected = sniff(file.buffer);
      if (!detected || detected.kind !== kind) {
        throw new HttpError(
          415,
          "UNSUPPORTED_FILE",
          kind === "image" ? "Upload a JPEG, PNG or WebP image" : "Upload an MP4 or WebM video",
        );
      }
      if (file.size > UPLOAD_LIMITS[kind]) {
        throw new HttpError(
          413,
          "FILE_TOO_LARGE",
          `${kind === "image" ? "Images" : "Videos"} can be up to ${UPLOAD_LIMITS[kind] / 1024 / 1024} MB`,
        );
      }
      res.status(201).json(
        await deps.uploads.save({
          buffer: file.buffer,
          ext: detected.ext,
          contentType: detected.contentType,
        }),
      );
    },
  );

  // ---------- orders ----------
  router.get("/orders", async (req, res) => {
    res.json(await listOrders(adminOrderQuerySchema.parse(req.query)));
  });
  router.get("/orders/:id", async (req, res) => {
    res.json(await getOrder(idParam(req)));
  });
  router.post("/orders/:id/status", async (req, res) => {
    const { status, note } = orderStatusChangeSchema.parse(req.body);
    res.json(await changeOrderStatus(idParam(req), status, who(req), deps.orders, note));
  });
  router.post("/orders/:id/tracking", async (req, res) => {
    res.json(await setTracking(idParam(req), trackingSchema.parse(req.body)));
  });
  router.post("/orders/:id/shiprocket", async (req, res) => {
    res.json(await shipWithShiprocket(idParam(req), deps.shipping, who(req)));
  });
  router.get("/shipping/status", (_req, res) => {
    res.json({ shiprocket: !!deps.shipping });
  });
  router.post("/orders/:id/cancel", async (req, res) => {
    res.json(await cancelOrder(idParam(req), cancelSchema.parse(req.body).note, who(req)));
  });
  router.post("/orders/:id/refund", requireOwner, async (req, res) => {
    res.json(await refundOrder(idParam(req), refundSchema.parse(req.body), who(req), deps.orders));
  });

  // ---------- bookings ----------
  router.get("/bookings", async (req, res) => {
    res.json(await listBookings(adminBookingQuerySchema.parse(req.query)));
  });
  router.get("/bookings/:id", async (req, res) => {
    res.json(await getBooking(idParam(req)));
  });
  router.post("/bookings", async (req, res) => {
    res
      .status(201)
      .json(await createManualBooking(adminBookingCreateSchema.parse(req.body), who(req), deps.bookings));
  });
  router.post("/bookings/:id/reschedule", async (req, res) => {
    res.json(
      await rescheduleBooking(idParam(req), rescheduleSchema.parse(req.body), who(req), deps.bookings),
    );
  });
  for (const action of ["cancel", "complete", "no_show"] as const) {
    router.post(`/bookings/:id/${action.replace("_", "-")}`, async (req, res) => {
      const note = z.object({ note: z.string().trim().max(300).default("") }).parse(req.body ?? {}).note;
      res.json(await setBookingOutcome(idParam(req), action, note, who(req), deps.bookings));
    });
  }
  router.post("/bookings/:id/mark-paid", async (req, res) => {
    res.json(await markBookingPaid(idParam(req), who(req)));
  });
  router.post("/bookings/:id/refund", requireOwner, async (req, res) => {
    res.json(await refundBooking(idParam(req), refundSchema.parse(req.body), who(req), deps.bookings));
  });

  // ---------- GST ----------
  router.get("/gst", async (req, res) => {
    const { month } = z.object({ month: z.string().regex(IST_MONTH) }).parse(req.query);
    res.json(await gstReport(month));
  });
  router.get("/gst.csv", async (req, res) => {
    const { month } = z.object({ month: z.string().regex(IST_MONTH) }).parse(req.query);
    res
      .type("text/csv")
      .set("Content-Disposition", `attachment; filename="happy-nails-gst-${month}.csv"`)
      .send(await gstCsv(month));
  });
  router.get("/invoices", async (req, res) => {
    const q = z
      .object({
        number: z.string().max(30).optional(),
        source: z.enum(["order", "booking"]).optional(),
        sourceId: z.string().optional(),
      })
      .parse(req.query);
    const filter = q.number
      ? { number: q.number }
      : q.source && q.sourceId && mongoose.isValidObjectId(q.sourceId)
        ? { "source.type": q.source, "source.id": q.sourceId }
        : null;
    if (!filter) throw new HttpError(400, "BAD_REQUEST", "Give an invoice number or a source");
    res.json((await Invoice.find(filter).sort({ issuedAt: 1 }).lean()).map(toInvoiceDto));
  });

  // ---------- availability calendar ----------
  // A month per technician: each day's working times (and where they come from) with its bookings.
  router.get("/calendar", async (req, res) => {
    const q = calendarQuerySchema.parse(req.query);
    const dates = daysOfMonth(q.month);
    const [days, bookings] = await Promise.all([
      effectiveDays([q.technicianId], dates),
      Booking.find({
        technicianId: q.technicianId,
        status: { $in: ["confirmed", "pending_payment", "completed"] },
        startsAt: {
          $gte: istToUtc(dates[0]!, "00:00"),
          $lt: istToUtc(addIstDays(dates[dates.length - 1]!, 1), "00:00"),
        },
      })
        .sort({ startsAt: 1 })
        .select({ number: 1, startsAt: 1, endsAt: 1, city: 1, customer: 1, status: 1, serviceName: 1 })
        .lean(),
    ]);
    res.json(
      days.map((d) => ({
        date: d.date,
        source: d.source,
        slotTimes: d.grid,
        note: d.note ?? "",
        bookings: bookings
          .filter((b) => istDateOf(b.startsAt) === d.date)
          .map((b) => ({
            id: String(b._id),
            number: b.number,
            startsAt: b.startsAt,
            endsAt: b.endsAt,
            city: b.city,
            customerName: b.customer.name,
            serviceName: b.serviceName,
            status: b.status,
          })),
      })),
    );
  });

  router.put("/calendar/:id/:date", requireOwner, async (req, res) => {
    const id = idParam(req);
    const date = z.string().regex(IST_DATE).parse(req.params.date);
    await found(Technician.findById(id), "technician");
    const { slotTimes, note } = calendarDaySchema.parse(req.body);
    await AvailabilityOverride.updateOne(
      { technicianId: id, date },
      { $set: { slotTimes: [...new Set(slotTimes)].sort(), note } },
      { upsert: true },
    );
    res.json({ ok: true });
  });

  router.delete("/calendar/:id/:date", requireOwner, async (req, res) => {
    await AvailabilityOverride.deleteOne({ technicianId: idParam(req), date: String(req.params.date) });
    res.status(204).end();
  });

  // ---------- technicians and their hours ----------
  router.get("/technicians", async (_req, res) => {
    const [techs, rules, blocks] = await Promise.all([
      Technician.find().sort({ name: 1 }).lean(),
      AvailabilityRule.find().lean(),
      AvailabilityBlock.find({ toDate: { $gte: istDateOf(new Date()) } })
        .sort({ fromDate: 1 })
        .lean(),
    ]);
    res.json(
      techs.map((t) => ({
        ...t,
        week: rules
          .filter((r) => r.technicianId.equals(t._id))
          .map((r) => ({ weekday: r.weekday, slotTimes: r.slotTimes }))
          .sort((a, b) => a.weekday - b.weekday),
        blocks: blocks.filter((b) => b.technicianId.equals(t._id)),
      })),
    );
  });
  router.post("/technicians", requireOwner, async (req, res) => {
    res.status(201).json(await Technician.create(technicianInputSchema.parse(req.body)));
  });
  router.patch("/technicians/:id", requireOwner, async (req, res) => {
    const input = parsePatch(technicianInputSchema, req.body);
    res.json(
      await found(
        Technician.findByIdAndUpdate(idParam(req), { $set: input }, { new: true, runValidators: true }),
        "technician",
      ),
    );
  });
  router.put("/technicians/:id/hours", requireOwner, async (req, res) => {
    const id = idParam(req);
    await found(Technician.findById(id), "technician");
    const { days } = weeklyHoursSchema.parse(req.body);
    await mongoose.connection.transaction(async (session) => {
      await AvailabilityRule.deleteMany({ technicianId: id }, { session });
      if (days.length) {
        await AvailabilityRule.insertMany(
          days.map((d) => ({
            technicianId: id,
            weekday: d.weekday,
            slotTimes: [...new Set(d.slotTimes)].sort(),
          })),
          { session },
        );
      }
    });
    res.json({ ok: true });
  });
  router.post("/technicians/:id/blocks", requireOwner, async (req, res) => {
    const id = idParam(req);
    await found(Technician.findById(id), "technician");
    res
      .status(201)
      .json(await AvailabilityBlock.create({ technicianId: id, ...blockInputSchema.parse(req.body) }));
  });
  router.delete("/technicians/:id/blocks/:blockId", requireOwner, async (req, res) => {
    await AvailabilityBlock.deleteOne({ _id: String(req.params.blockId), technicianId: idParam(req) });
    res.status(204).end();
  });

  // ---------- services and add-ons ----------
  for (const [path, model] of [
    ["services", Service],
    ["addons", Addon],
  ] as const) {
    router.get(`/${path}`, async (_req, res) => {
      res.json(await (model as typeof Service).find().sort({ sortOrder: 1, name: 1 }).lean());
    });
    router.post(`/${path}`, requireOwner, async (req, res) => {
      res.status(201).json(await (model as typeof Service).create(offeringInputSchema.parse(req.body)));
    });
    router.patch(`/${path}/:id`, requireOwner, async (req, res) => {
      const input = parsePatch(offeringInputSchema, req.body);
      res.json(
        await found(
          (model as typeof Service).findByIdAndUpdate(
            idParam(req),
            { $set: input },
            { new: true, runValidators: true },
          ),
        ),
      );
    });
  }

  // ---------- testimonials ----------
  router.get("/testimonials", async (_req, res) => {
    res.json(await Testimonial.find().sort({ sortOrder: 1, createdAt: -1 }).lean());
  });
  router.post("/testimonials", requireOwner, async (req, res) => {
    res.status(201).json(await Testimonial.create(testimonialInputSchema.parse(req.body)));
  });
  router.patch("/testimonials/:id", requireOwner, async (req, res) => {
    const input = parsePatch(testimonialInputSchema, req.body);
    res.json(
      await found(Testimonial.findByIdAndUpdate(idParam(req), { $set: input }, { new: true }), "testimonial"),
    );
  });
  router.delete("/testimonials/:id", requireOwner, async (req, res) => {
    await Testimonial.deleteOne({ _id: idParam(req) });
    res.status(204).end();
  });

  return router;
}

/** Public: published testimonials only. Nothing is shown until the owner adds real ones. */
export function testimonialsRouter(): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const list = await Testimonial.find({ published: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json(
      list.map((t) => ({
        id: String(t._id),
        name: t.name,
        city: t.city,
        setName: t.setName,
        quote: t.quote,
        videoUrl: t.videoUrl,
        posterUrl: t.posterUrl,
      })),
    );
  });
  return router;
}
