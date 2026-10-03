import { z } from "zod";
import { indianMobileSchema } from "./checkout";
import { VISIT_CITIES } from "./pincode";
import { IST_DATE, IST_MONTH, IST_TIME } from "./time";

/** A slot must start at least this far ahead, and no further out than the horizon (build plan, section 7). */
export const BOOKING_MIN_LEAD_MS = 3 * 60 * 60 * 1000;
export const BOOKING_HORIZON_DAYS = 90;
export const HOLD_TTL_SECONDS = 10 * 60;
/** A day with this many open slots or fewer shows the "few left" dot. */
export const FEW_SLOTS_THRESHOLD = 2;

export const visitCitySchema = z.enum(VISIT_CITIES);
const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const paise = z.number().int().nonnegative();

export const serviceSchema = z.object({
  id: objectId,
  name: z.string(),
  description: z.string(),
  minutes: z.number().int().positive(),
  pricePaise: paise,
});
export type Service = z.infer<typeof serviceSchema>;

export const addonSchema = serviceSchema.extend({
  /** Shown next to the price, e.g. "per hand". */
  unitNote: z.string().optional(),
});
export type Addon = z.infer<typeof addonSchema>;

export const servicesResponseSchema = z.object({
  services: z.array(serviceSchema),
  addons: z.array(addonSchema),
});
export type ServicesResponse = z.infer<typeof servicesResponseSchema>;

const addonIdsSchema = z.array(objectId).max(10);

/** Query string: addonIds as a comma-separated list. */
export const availabilityQuerySchema = z.object({
  city: visitCitySchema,
  serviceId: objectId,
  addonIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(addonIdsSchema),
  month: z.string().regex(IST_MONTH, "Expected YYYY-MM"),
});

export const slotSchema = z.object({
  time: z.string().regex(IST_TIME),
  startsAt: z.string(),
  open: z.boolean(),
});
export type Slot = z.infer<typeof slotSchema>;

export const availabilityResponseSchema = z.object({
  month: z.string(),
  city: visitCitySchema,
  minutes: z.number().int(),
  days: z.array(
    z.object({
      date: z.string().regex(IST_DATE),
      openCount: z.number().int().nonnegative(),
      slots: z.array(slotSchema),
    }),
  ),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

export const nextSlotResponseSchema = z.object({
  city: visitCitySchema,
  startsAt: z.string().nullable(),
});

export const holdRequestSchema = z.object({
  city: visitCitySchema,
  serviceId: objectId,
  addonIds: addonIdsSchema.default([]),
  startsAt: z.iso.datetime(),
});
export type HoldRequest = z.input<typeof holdRequestSchema>;

export const holdResponseSchema = z.object({
  holdToken: z.string(),
  expiresAt: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});
export type HoldResponse = z.infer<typeof holdResponseSchema>;

export const createBookingRequestSchema = z.object({
  holdToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  customer: z.object({
    name: z.string().trim().min(2, "Enter your name").max(80),
    phone: indianMobileSchema,
  }),
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6 digit pincode"),
  address: z.string().trim().min(9, "Add the address for the visit").max(300),
  notes: z.string().trim().max(500).default(""),
});
export type CreateBookingRequest = z.input<typeof createBookingRequestSchema>;

export const bookingConfirmationSchema = z.object({
  number: z.string(),
  firstName: z.string(),
  city: visitCitySchema,
  serviceName: z.string(),
  addonNames: z.array(z.string()),
  startsAt: z.string(),
  endsAt: z.string(),
  minutes: z.number().int(),
  totalPaise: paise,
});
export type BookingConfirmation = z.infer<typeof bookingConfirmationSchema>;

export const pincodeCheckRequestSchema = z.object({ pincode: z.string().regex(/^\d{6}$/) });
export const pincodeCheckResponseSchema = z.object({
  covered: z.boolean(),
  city: visitCitySchema.nullable(),
});
