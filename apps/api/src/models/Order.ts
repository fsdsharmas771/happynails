import { INDIAN_STATES, ORDER_STATUSES, SHIPPING_SPEEDS, SIZING_OPTION_KEYS } from "@happynails/shared";
import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

const int = { validator: Number.isInteger, message: "{PATH} must be an integer" };
const paise = { type: Number, required: true, min: 0, validate: int } as const;

// Nested objects are required sub-schemas so they are never optional in the inferred types.
const customerSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
  },
  { _id: false },
);
const addressSchema = new Schema(
  {
    line: { type: String, required: true },
    pincode: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true, enum: INDIAN_STATES },
  },
  { _id: false },
);
const paymentSchema = new Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ["pending", "failed", "captured", "refunded"] as const,
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    paidAt: Date,
    failureReason: String,
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    /** Human-readable, e.g. HN260001. */
    number: { type: String, required: true, unique: true },
    customer: { type: customerSchema, required: true },
    address: { type: addressSchema, required: true },
    /** Price snapshots taken when the order was placed. */
    items: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        slug: { type: String, required: true },
        name: { type: String, required: true },
        optionKey: { type: String, required: true, enum: SIZING_OPTION_KEYS },
        optionLabel: { type: String, required: true },
        unitPaise: paise,
        qty: { type: Number, required: true, min: 1, validate: int },
      },
    ],
    subtotalPaise: paise,
    shippingPaise: paise,
    totalPaise: paise,
    shippingSpeed: { type: String, required: true, enum: SHIPPING_SPEEDS },
    payment: { type: paymentSchema, required: true },
    status: { type: String, required: true, enum: ORDER_STATUSES },
    /** reserved: held for an unpaid order; committed: sold; released: returned to stock. */
    stockState: { type: String, required: true, enum: ["reserved", "committed", "released"] },
    tracking: { carrier: String, awb: String, url: String },
    /** Shiprocket ids once a shipment is created there. */
    shiprocket: { orderId: String, shipmentId: String },
    /** SHA-256 of the guest tracking token; the token itself is only ever in the customer's link. */
    trackTokenHash: { type: String, required: true },
    refunds: [
      {
        _id: false,
        razorpayRefundId: { type: String, required: true },
        amountPaise: { type: Number, required: true, validate: int },
        reason: String,
        at: { type: Date, required: true },
      },
    ],
    deliveryDays: { type: [Number], default: undefined },
    events: [
      {
        _id: false,
        status: { type: String, required: true, enum: ORDER_STATUSES },
        at: { type: Date, required: true },
        note: String,
      },
    ],
  },
  { timestamps: true },
);

orderSchema.index(
  { "payment.razorpayOrderId": 1 },
  { unique: true, partialFilterExpression: { "payment.razorpayOrderId": { $type: "string" } } },
);
orderSchema.index({ status: 1, createdAt: -1 });

export type OrderAttrs = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<OrderAttrs>;
export const Order = model("Order", orderSchema);

/** Monotonic counters, e.g. one per year for order numbers. */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true },
});
export const Counter = model("Counter", counterSchema);

/** Razorpay webhook event ids already handled; the unique _id makes replays no-ops. */
const processedWebhookSchema = new Schema(
  {
    _id: { type: String, required: true },
    event: { type: String, required: true },
    outcome: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const ProcessedWebhook = model("ProcessedWebhook", processedWebhookSchema);
