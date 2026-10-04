import {
  availabilityResponseSchema,
  bookingConfirmationSchema,
  createOrderResponseSchema,
  holdResponseSchema,
  invoiceSchema,
  nextSlotResponseSchema,
  pincodeCheckResponseSchema,
  publicTestimonialSchema,
  servicesResponseSchema,
  type CreateBookingRequest,
  type HoldRequest,
  type VisitCity,
  etaResponseSchema,
  productDetailResponseSchema,
  productListResponseSchema,
  quoteResponseSchema,
  razorpayCheckoutSchema,
  trackedBookingSchema,
  trackedOrderSchema,
  type BookingAccess,
  type CreateOrderRequest,
  type OrderAccess,
  type QuoteRequest,
} from "@happynails/shared";
import { z } from "zod";

/** Error carrying the API's stable error code (see apps/api/src/middleware/error.ts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Parser<T> {
  parse(data: unknown): T;
}

async function request<T>(
  path: string,
  schema: Parser<T>,
  init?: { method: "POST" | "DELETE"; body?: unknown },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText);
  }
  return schema.parse(body);
}

export const api = {
  products: () => request("/products", productListResponseSchema),
  product: (slug: string) => request(`/products/${encodeURIComponent(slug)}`, productDetailResponseSchema),
  deliveryEstimate: (pincode: string) =>
    request("/shipping/eta", etaResponseSchema, { method: "POST", body: { pincode } }),
  quote: (body: QuoteRequest) => request("/checkout/quote", quoteResponseSchema, { method: "POST", body }),
  createOrder: (body: CreateOrderRequest) =>
    request("/orders", createOrderResponseSchema, { method: "POST", body }),
  verifyPayment: (body: {
    orderNumber: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => request("/payments/razorpay/verify", z.object({ verified: z.boolean() }), { method: "POST", body }),
  trackOrder: ({ number, token }: OrderAccess) =>
    request(
      `/orders/track?number=${encodeURIComponent(number)}&token=${encodeURIComponent(token)}`,
      trackedOrderSchema,
    ),
  resumePayment: (body: OrderAccess) =>
    request("/orders/pay", z.object({ orderNumber: z.string(), razorpay: razorpayCheckoutSchema }), {
      method: "POST",
      body,
    }),
  services: () => request("/services", servicesResponseSchema),
  testimonials: () => request("/testimonials", publicTestimonialSchema.array()),
  availability: (q: { city: VisitCity; serviceId: string; addonIds: string[]; month: string }) =>
    request(
      `/availability?${new URLSearchParams({
        city: q.city,
        serviceId: q.serviceId,
        month: q.month,
        ...(q.addonIds.length ? { addonIds: q.addonIds.join(",") } : {}),
      })}`,
      availabilityResponseSchema,
    ),
  nextSlot: (city: VisitCity) =>
    request(`/availability/next?city=${encodeURIComponent(city)}`, nextSlotResponseSchema),
  checkPincode: (pincode: string) =>
    request("/pincode/check", pincodeCheckResponseSchema, { method: "POST", body: { pincode } }),
  holdSlot: (body: HoldRequest) => request("/bookings/hold", holdResponseSchema, { method: "POST", body }),
  releaseHold: (token: string) =>
    request(`/bookings/hold/${encodeURIComponent(token)}`, { parse: () => undefined }, { method: "DELETE" }),
  createBooking: (body: CreateBookingRequest) =>
    request("/bookings", bookingConfirmationSchema, { method: "POST", body }),
  trackBooking: ({ number, token }: BookingAccess) =>
    request(
      `/bookings/track?number=${encodeURIComponent(number)}&token=${encodeURIComponent(token)}`,
      trackedBookingSchema,
    ),
  resumeBookingPayment: (body: BookingAccess) =>
    request("/bookings/pay", z.object({ number: z.string(), razorpay: razorpayCheckoutSchema }), {
      method: "POST",
      body,
    }),
  payBookingLater: (body: BookingAccess) =>
    request("/bookings/pay-later", trackedBookingSchema, { method: "POST", body }),
  orderInvoice: ({ number, token }: OrderAccess) =>
    request(
      `/orders/invoice?number=${encodeURIComponent(number)}&token=${encodeURIComponent(token)}`,
      invoiceSchema.array(),
    ),
  bookingInvoice: ({ number, token }: BookingAccess) =>
    request(
      `/bookings/invoice?number=${encodeURIComponent(number)}&token=${encodeURIComponent(token)}`,
      invoiceSchema.array(),
    ),
  verifyBookingPayment: (body: {
    number: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => request("/bookings/verify-payment", z.object({ verified: z.boolean() }), { method: "POST", body }),
};
