import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors";
import { applyCourierUpdate } from "../orders/admin";
import type { OrderDeps } from "../orders/service";

const tokenMatches = (expected: string, given: string) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

const updateSchema = z.object({
  awb: z.union([z.string(), z.number()]).transform(String),
  current_status: z.string().max(100),
});

/**
 * Courier tracking webhook (Shiprocket). The path avoids carrier names because Shiprocket rejects
 * webhook URLs containing them. Secured by the token configured in Shiprocket, sent as x-api-key.
 */
export function courierWebhookRouter(token: string | undefined, deps: OrderDeps): Router {
  const router = Router();
  router.post("/courier-tracking", async (req, res) => {
    if (!token) throw new HttpError(503, "SHIPPING_UNAVAILABLE", "Courier tracking is not configured");
    if (!tokenMatches(token, req.get("x-api-key") ?? ""))
      throw new HttpError(401, "UNAUTHENTICATED", "Bad token");
    const parsed = updateSchema.safeParse(req.body);
    // Acknowledge anything we cannot use, so the courier does not keep retrying it.
    if (!parsed.success) {
      res.json({ ok: true, outcome: "ignored" });
      return;
    }
    const outcome = await applyCourierUpdate(parsed.data.awb, parsed.data.current_status, deps);
    req.log.info({ awb: parsed.data.awb, status: parsed.data.current_status, outcome }, "courier update");
    res.json({ ok: true, outcome });
  });
  return router;
}
