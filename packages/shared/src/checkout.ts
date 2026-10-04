import { z } from "zod";
import { cartItemSchema, productImageSchema, sizingOptionKeySchema, slugSchema } from "./catalogue";
import { hexColorSchema, nailFinishSchema, nailShapeSchema } from "./nail";

export const SHIPPING_SPEEDS = ["standard", "express"] as const;
export const shippingSpeedSchema = z.enum(SHIPPING_SPEEDS);
export type ShippingSpeed = z.infer<typeof shippingSpeedSchema>;

export const MAX_CART_LINES = 20;

const paise = z.number().int().nonnegative();

export const quoteRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(MAX_CART_LINES),
  shippingSpeed: shippingSpeedSchema.default("standard"),
});
export type QuoteRequest = z.input<typeof quoteRequestSchema>;

export const quoteLineSchema = z.object({
  slug: slugSchema,
  option: sizingOptionKeySchema,
  qty: z.number().int().positive(),
  /** False when the set is gone, inactive, or has fewer than `qty` in stock. */
  available: z.boolean(),
  /** Null only when the set no longer exists. */
  product: z
    .object({
      name: z.string(),
      shape: nailShapeSchema,
      finish: nailFinishSchema,
      color: hexColorSchema,
      color2: hexColorSchema.optional(),
      image: productImageSchema.optional(),
    })
    .nullable(),
  optionLabel: z.string(),
  unitPaise: paise,
  linePaise: paise,
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const totalsSchema = z.object({
  subtotalPaise: paise,
  shippingPaise: paise,
  totalPaise: paise,
});
export type Totals = z.infer<typeof totalsSchema>;

export const quoteResponseSchema = z.object({
  lines: z.array(quoteLineSchema),
  totals: totalsSchema,
  /** Totals cover available lines only; checkout is blocked while any line is unavailable. */
  allAvailable: z.boolean(),
  pricing: z.object({
    freeShippingThresholdPaise: paise,
    standardShippingPaise: paise,
    expressShippingPaise: paise,
  }),
  /** False when the server has no Razorpay keys; checkout cannot complete without them. */
  onlinePaymentAvailable: z.boolean(),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

/** Indian mobile number: 10 digits starting 6 to 9. */
export const indianMobileSchema = z.string().regex(/^[6-9]\d{9}$/, "Enter a 10 digit mobile number");

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  phone: indianMobileSchema,
  email: z.email("Enter a valid email").max(120),
});

export const addressSchema = z.object({
  line: z.string().trim().min(9, "Add your full address").max(300),
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6 digit pincode"),
  city: z.string().trim().min(2, "Enter your city").max(60),
  state: z.enum(INDIAN_STATES, { error: "Choose your state" }),
});

export const createOrderRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(MAX_CART_LINES),
  customer: customerSchema,
  address: addressSchema,
  shippingSpeed: shippingSpeedSchema,
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const razorpayCheckoutSchema = z.object({
  keyId: z.string(),
  orderId: z.string(),
  amount: paise,
  currency: z.literal("INR"),
});
export type RazorpayCheckout = z.infer<typeof razorpayCheckoutSchema>;

export const createOrderResponseSchema = z.object({
  orderNumber: z.string(),
  trackToken: z.string(),
  status: z.literal("pending_payment"),
  totalPaise: paise,
  /** What Razorpay Checkout needs to open. */
  razorpay: razorpayCheckoutSchema,
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

export const verifyPaymentRequestSchema = z.object({
  orderNumber: z.string().max(20),
  razorpay_order_id: z.string().max(64),
  razorpay_payment_id: z.string().max(64),
  razorpay_signature: z.string().max(256),
});

export const orderAccessSchema = z.object({
  number: z.string().regex(/^HN\d{6,}$/),
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});
export type OrderAccess = z.infer<typeof orderAccessSchema>;

export const ORDER_STATUSES = [
  "pending_payment",
  "placed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** What a customer sees on the tracking page. No phone, email or full address. */
export const trackedOrderSchema = z.object({
  number: z.string(),
  status: orderStatusSchema,
  firstName: z.string(),
  city: z.string(),
  placedAt: z.string(),
  paymentStatus: z.enum(["pending", "failed", "captured", "refunded"]),
  shippingSpeed: shippingSpeedSchema,
  items: z.array(
    z.object({
      name: z.string(),
      optionLabel: z.string(),
      qty: z.number().int(),
      linePaise: paise,
    }),
  ),
  totals: totalsSchema,
  tracking: z.object({ carrier: z.string(), awb: z.string(), url: z.string() }).partial().optional(),
  events: z.array(z.object({ status: orderStatusSchema, at: z.string() })),
  /** Set once the GST invoice is issued (after payment). */
  invoiceNumber: z.string().optional(),
  /** Standard delivery window in days from placement. */
  deliveryDays: z.tuple([z.number().int(), z.number().int()]).optional(),
});
export type TrackedOrder = z.infer<typeof trackedOrderSchema>;
