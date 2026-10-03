import {
  BOOKING_PAYMENT_METHODS,
  BOOKING_PAYMENT_STATUSES,
  BOOKING_STATUSES,
  VISIT_CITIES,
} from "@happynails/shared";
import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

const int = { validator: Number.isInteger, message: "{PATH} must be an integer" };
const IST_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const offering = {
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  minutes: { type: Number, required: true, min: 5, validate: int },
  pricePaise: { type: Number, required: true, min: 0, validate: int },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
};

export const Service = model("Service", new Schema(offering, { timestamps: true }));

export const Addon = model(
  "Addon",
  new Schema(
    {
      ...offering,
      /** e.g. "per hand"; display only, the price is what is charged. */
      unitNote: String,
    },
    { timestamps: true },
  ),
);

const technicianSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    cities: { type: [{ type: String, enum: VISIT_CITIES }], required: true },
    active: { type: Boolean, default: true },
    photo: String,
  },
  { timestamps: true },
);
export const Technician = model("Technician", technicianSchema);

/** Which slot start times a technician works on a weekday (0 = Sunday), India time. */
const availabilityRuleSchema = new Schema(
  {
    technicianId: { type: Schema.Types.ObjectId, ref: "Technician", required: true, index: true },
    weekday: { type: Number, required: true, min: 0, max: 6, validate: int },
    slotTimes: { type: [{ type: String, match: IST_TIME }], required: true },
    /** Inclusive India calendar days; open-ended when absent. */
    validFrom: { type: String, match: IST_DATE },
    validTo: { type: String, match: IST_DATE },
  },
  { timestamps: true },
);
export const AvailabilityRule = model("AvailabilityRule", availabilityRuleSchema);

/** Days a technician is unavailable (leave, training), inclusive India calendar days. */
const availabilityBlockSchema = new Schema(
  {
    technicianId: { type: Schema.Types.ObjectId, ref: "Technician", required: true, index: true },
    fromDate: { type: String, required: true, match: IST_DATE },
    toDate: { type: String, required: true, match: IST_DATE },
    reason: { type: String, default: "" },
  },
  { timestamps: true },
);
export const AvailabilityBlock = model("AvailabilityBlock", availabilityBlockSchema);

/** Statuses that hold a technician: an unpaid online booking blocks its slot until it expires. */
export const SLOT_BLOCKING_STATUSES = ["confirmed", "pending_payment"] as const;

const bookingPaymentSchema = new Schema(
  {
    method: { type: String, required: true, enum: BOOKING_PAYMENT_METHODS },
    status: { type: String, required: true, enum: BOOKING_PAYMENT_STATUSES },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    paidAt: Date,
    failureReason: String,
  },
  { _id: false },
);

const bookingSchema = new Schema(
  {
    /** Human-readable, e.g. HN-V260001. */
    number: { type: String, required: true, unique: true },
    customer: {
      type: new Schema(
        { name: { type: String, required: true }, phone: { type: String, required: true } },
        { _id: false },
      ),
      required: true,
    },
    city: { type: String, required: true, enum: VISIT_CITIES },
    pincode: { type: String, required: true },
    address: { type: String, required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    /** Snapshots taken at booking time, so later price edits do not change past bookings. */
    serviceName: { type: String, required: true },
    addons: [
      {
        _id: false,
        addonId: { type: Schema.Types.ObjectId, ref: "Addon", required: true },
        name: { type: String, required: true },
        pricePaise: { type: Number, required: true, validate: int },
        minutes: { type: Number, required: true, validate: int },
      },
    ],
    totalPaise: { type: Number, required: true, min: 0, validate: int },
    minutes: { type: Number, required: true, min: 1, validate: int },
    technicianId: { type: Schema.Types.ObjectId, ref: "Technician", required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, required: true, enum: BOOKING_STATUSES },
    payment: { type: bookingPaymentSchema, required: true },
    /** SHA-256 of the customer's access token; the token itself is only shown to them. */
    trackTokenHash: { type: String, required: true },
    notes: { type: String, default: "" },
    reminderSentAt: Date,
    events: [
      {
        _id: false,
        status: { type: String, required: true, enum: BOOKING_STATUSES },
        at: { type: Date, required: true },
        note: String,
      },
    ],
  },
  { timestamps: true },
);

// Database-level guard against double booking: one slot-holding booking per technician per start.
bookingSchema.index(
  { technicianId: 1, startsAt: 1 },
  {
    name: "one_active_booking_per_technician_start",
    unique: true,
    partialFilterExpression: { status: { $in: [...SLOT_BLOCKING_STATUSES] } },
  },
);
bookingSchema.index(
  { "payment.razorpayOrderId": 1 },
  { unique: true, partialFilterExpression: { "payment.razorpayOrderId": { $type: "string" } } },
);
bookingSchema.index({ technicianId: 1, status: 1, startsAt: 1, endsAt: 1 });
bookingSchema.index({ status: 1, startsAt: 1 });

export type BookingAttrs = InferSchemaType<typeof bookingSchema>;
export type BookingDoc = HydratedDocument<BookingAttrs>;
export const Booking = model("Booking", bookingSchema);
