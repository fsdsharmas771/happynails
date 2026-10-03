import {
  createOrderResponseSchema,
  etaResponseSchema,
  productDetailResponseSchema,
  productListResponseSchema,
  quoteResponseSchema,
  razorpayCheckoutSchema,
  trackedOrderSchema,
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
  init?: { method: "POST"; body: unknown },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: { Accept: "application/json", ...(init ? { "Content-Type": "application/json" } : {}) },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  const body: unknown = await res.json().catch(() => null);
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
};
