import type { Express, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { HttpError } from "../errors";

/**
 * Per-IP request limits for the public API. Counts are kept in memory, which suits a single API
 * container; they reset when it restarts. Webhooks are not limited: Razorpay and Shiprocket are
 * checked by signature and token instead, and dropping their retries would lose payments.
 */
export interface RateLimits {
  /** Any API request. */
  general: number;
  /** Placing orders and bookings, and starting payments. Per 15 minutes. */
  checkout: number;
  /** Slot holds while choosing a time. Per 15 minutes. */
  holds: number;
  /** Tracking, invoice, pincode and delivery lookups, payment verification. Per 5 minutes. */
  lookups: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { general: 300, checkout: 20, holds: 40, lookups: 60 };

function limiter(limit: number, windowMs: number, message: string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, "RATE_LIMITED", message)),
  });
}

const CHECKOUT = [
  ["post", "/api/orders"],
  ["post", "/api/orders/pay"],
  ["post", "/api/bookings"],
  ["post", "/api/bookings/pay"],
  ["post", "/api/bookings/pay-later"],
] as const;

const LOOKUPS = [
  ["get", "/api/orders/track"],
  ["get", "/api/orders/invoice"],
  ["get", "/api/bookings/track"],
  ["get", "/api/bookings/invoice"],
  ["post", "/api/pincode/check"],
  ["post", "/api/shipping/eta"],
  ["post", "/api/payments/razorpay/verify"],
  ["post", "/api/bookings/verify-payment"],
] as const;

/** Mounts the limits ahead of the routers. Call before any `/api` route is registered. */
export function applyRateLimits(app: Express, limits: RateLimits) {
  const general = limiter(limits.general, 60_000, "Too many requests. Please wait a minute.");
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/webhooks/") || req.path === "/health") return next();
    general(req, res, next);
  });

  const checkout = limiter(
    limits.checkout,
    15 * 60_000,
    "Too many attempts. Please wait a few minutes, or message us on WhatsApp.",
  );
  for (const [method, path] of CHECKOUT) app[method](path, checkout);

  app.post(
    "/api/bookings/hold",
    limiter(limits.holds, 15 * 60_000, "Too many time changes. Please wait a few minutes."),
  );

  const lookups = limiter(limits.lookups, 5 * 60_000, "Too many lookups. Please wait a few minutes.");
  for (const [method, path] of LOOKUPS) app[method](path, lookups);
}
