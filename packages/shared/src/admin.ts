import { z } from "zod";
import { BOOKING_STATUSES } from "./booking";
import { OCCASIONS, productImageSchema, slugSchema } from "./catalogue";
import { indianMobileSchema, ORDER_STATUSES } from "./checkout";
import { hexColorSchema, nailFinishSchema, nailShapeSchema } from "./nail";
import { VISIT_CITIES } from "./pincode";
import { IST_DATE, IST_TIME } from "./time";

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const paise = z.number().int().nonnegative();

export const adminLoginSchema = z.object({
  email: z.email().max(120),
  password: z.string().min(1).max(200),
});

export const adminMeSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["owner", "staff"]),
});
export type AdminMe = z.infer<typeof adminMeSchema>;

// ---------- products ----------

export const adminProductInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(""),
  shape: nailShapeSchema,
  finish: nailFinishSchema,
  occasion: z.enum(OCCASIONS),
  color: hexColorSchema,
  color2: hexColorSchema.optional().or(z.literal("").transform(() => undefined)),
  pricePaise: paise.max(10_000_000),
  stock: z.number().int().min(0).max(100_000),
  images: z.array(productImageSchema).max(8).default([]),
  active: z.boolean().default(true),
});
export const stockAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, "Change must not be zero"),
  reason: z.string().trim().min(2).max(200),
});
export const reorderSchema = z.object({ ids: z.array(objectId).min(1).max(500) });

// ---------- orders ----------

export const orderStatusChangeSchema = z.object({
  status: z.enum(["packed", "shipped", "delivered"]),
  note: z.string().trim().max(300).optional(),
});
export const trackingSchema = z.object({
  carrier: z.string().trim().min(2).max(60),
  awb: z.string().trim().min(3).max(60),
  url: z
    .url()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export const refundSchema = z.object({
  /** Omit for a full refund of what is left. */
  amountPaise: z.number().int().positive().optional(),
  reason: z.string().trim().min(2).max(200),
});
export const cancelSchema = z.object({ note: z.string().trim().min(2).max(300) });
export const adminOrderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// ---------- bookings ----------

export const adminBookingQuerySchema = z.object({
  from: z.string().regex(IST_DATE),
  to: z.string().regex(IST_DATE),
  city: z.enum(VISIT_CITIES).optional(),
  technicianId: objectId.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
});
export const adminBookingCreateSchema = z.object({
  city: z.enum(VISIT_CITIES),
  pincode: z.string().regex(/^\d{6}$/),
  address: z.string().trim().min(9).max(300),
  customer: z.object({ name: z.string().trim().min(2).max(80), phone: indianMobileSchema }),
  serviceId: objectId,
  addonIds: z.array(objectId).max(10).default([]),
  startsAt: z.iso.datetime(),
  technicianId: objectId.optional(),
  notes: z.string().trim().max(500).default(""),
});
export const rescheduleSchema = z.object({
  startsAt: z.iso.datetime(),
  technicianId: objectId.optional(),
});

// ---------- team, services, content ----------

export const technicianInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: indianMobileSchema,
  cities: z.array(z.enum(VISIT_CITIES)).min(1),
  active: z.boolean().default(true),
  photo: z.string().max(500).optional(),
});
export const weeklyHoursSchema = z.object({
  /** One entry per weekday that is worked (0 = Sunday). Replaces the whole week. */
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        slotTimes: z.array(z.string().regex(IST_TIME)).min(1).max(24),
      }),
    )
    .max(7),
});
export const blockInputSchema = z
  .object({
    fromDate: z.string().regex(IST_DATE),
    toDate: z.string().regex(IST_DATE),
    reason: z.string().trim().max(200).default(""),
  })
  .refine((b) => b.fromDate <= b.toDate, {
    message: "The end date is before the start date",
    path: ["toDate"],
  });

export const offeringInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  minutes: z.number().int().min(5).max(600),
  pricePaise: paise.max(10_000_000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  unitNote: z.string().trim().max(40).optional(),
});

export const testimonialInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().max(60).default(""),
  setName: z.string().trim().max(80).default(""),
  quote: z.string().trim().max(600).default(""),
  videoUrl: z.string().max(500).default(""),
  posterUrl: z.string().max(500).default(""),
  published: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const publicTestimonialSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  setName: z.string(),
  quote: z.string(),
  videoUrl: z.string(),
  posterUrl: z.string(),
});
export type PublicTestimonial = z.infer<typeof publicTestimonialSchema>;
