import { GST } from "@happynails/shared";
import type { Logger } from "pino";

/**
 * Parcel size and weight sent to Shiprocket for courier rates.
 * PLACEHOLDER: measure a packed kit and adjust; couriers bill on the larger of actual and volumetric weight.
 */
export const PACKAGE = { lengthCm: 15, breadthCm: 10, heightCm: 5, baseKg: 0.1, perSetKg: 0.1 } as const;

export interface ShipmentInput {
  orderNumber: string;
  orderDate: Date;
  customer: { name: string; phone: string; email: string };
  address: { line: string; pincode: string; city: string; state: string };
  items: { name: string; sku: string; qty: number; unitPaise: number }[];
  shippingPaise: number;
  totalPaise: number;
}

export interface ShipmentResult {
  srOrderId: string;
  shipmentId: string;
  awb?: string;
  courierName?: string;
  trackingUrl?: string;
}

/** What the admin needs from a courier aggregator. Shiprocket in the app; a fake in tests. */
export interface ShippingProvider {
  /** Creates the shipment (or reuses `existing`) and assigns a courier. */
  ship(input: ShipmentInput, existing?: { srOrderId: string; shipmentId: string }): Promise<ShipmentResult>;
}

export interface ShiprocketConfig {
  email: string;
  password: string;
  pickupLocation: string;
}

const BASE = "https://apiv2.shiprocket.in/v1/external";
/** Shiprocket tokens last 10 days; renew a day early. */
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;

const rupees = (paise: number) => Math.round(paise) / 100;
const fmtDate = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

export class ShiprocketError extends Error {
  constructor(
    message: string,
    readonly partial?: { srOrderId: string; shipmentId: string },
  ) {
    super(message);
    this.name = "ShiprocketError";
  }
}

export function createShiprocketProvider(
  cfg: ShiprocketConfig,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): ShippingProvider {
  let token: { value: string; until: number } | null = null;

  async function login(): Promise<string> {
    const res = await fetchImpl(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cfg.email, password: cfg.password }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
    if (!res.ok || !body?.token)
      throw new ShiprocketError(`Shiprocket sign-in failed: ${body?.message ?? res.status}`);
    token = { value: body.token, until: Date.now() + TOKEN_TTL_MS };
    return body.token;
  }

  async function call<T>(path: string, payload: unknown, retried = false): Promise<T> {
    const t = token && token.until > Date.now() ? token.value : await login();
    const res = await fetchImpl(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && !retried) {
      token = null;
      return call<T>(path, payload, true);
    }
    const body = (await res.json().catch(() => null)) as (T & { message?: string; errors?: unknown }) | null;
    if (!res.ok || !body) {
      const detail = body?.errors
        ? JSON.stringify(body.errors).slice(0, 300)
        : (body?.message ?? res.statusText);
      throw new ShiprocketError(`Shiprocket ${path} failed (${res.status}): ${detail}`);
    }
    return body;
  }

  return {
    async ship(input, existing) {
      let ids = existing;
      if (!ids) {
        const [first, ...rest] = input.customer.name.trim().split(/\s+/);
        const qty = input.items.reduce((n, i) => n + i.qty, 0);
        const created = await call<{
          order_id?: number | string;
          shipment_id?: number | string;
          status?: string;
        }>("/orders/create/adhoc", {
          order_id: input.orderNumber,
          order_date: fmtDate(input.orderDate),
          pickup_location: cfg.pickupLocation,
          billing_customer_name: first ?? input.customer.name,
          billing_last_name: rest.join(" "),
          billing_address: input.address.line,
          billing_city: input.address.city,
          billing_pincode: input.address.pincode,
          billing_state: input.address.state,
          billing_country: "India",
          billing_email: input.customer.email,
          billing_phone: input.customer.phone,
          shipping_is_billing: true,
          order_items: input.items.map((i) => ({
            name: i.name,
            sku: i.sku,
            units: i.qty,
            selling_price: rupees(i.unitPaise),
            hsn: GST.codes.pressOnNails,
          })),
          payment_method: "Prepaid",
          shipping_charges: rupees(input.shippingPaise),
          sub_total: rupees(input.totalPaise),
          length: PACKAGE.lengthCm,
          breadth: PACKAGE.breadthCm,
          height: PACKAGE.heightCm,
          weight: Math.round((PACKAGE.baseKg + PACKAGE.perSetKg * qty) * 100) / 100,
        });
        if (!created.shipment_id)
          throw new ShiprocketError(`Shiprocket did not return a shipment: ${created.status ?? "unknown"}`);
        ids = { srOrderId: String(created.order_id), shipmentId: String(created.shipment_id) };
        log.info({ order: input.orderNumber, shipment: ids.shipmentId }, "shiprocket order created");
      }

      let awb: { awb_code?: string; courier_name?: string } | undefined;
      try {
        const assigned = await call<{
          awb_assign_status?: number;
          response?: { data?: { awb_code?: string; courier_name?: string } };
        }>("/courier/assign/awb", { shipment_id: Number(ids.shipmentId) });
        awb = assigned.response?.data;
      } catch (err) {
        throw new ShiprocketError(
          `Shipment created in Shiprocket but no courier was assigned: ${(err as Error).message}. Assign one in Shiprocket or try again.`,
          ids,
        );
      }
      if (!awb?.awb_code) {
        throw new ShiprocketError(
          "Shipment created in Shiprocket but no courier was assigned. Try again or assign one in Shiprocket.",
          ids,
        );
      }

      // Pickup scheduling is best effort: it can also be requested in the Shiprocket panel.
      await call("/courier/generate/pickup", { shipment_id: [Number(ids.shipmentId)] }).catch((err) =>
        log.warn(
          { err: (err as Error).message, shipment: ids.shipmentId },
          "shiprocket pickup not scheduled",
        ),
      );

      return {
        ...ids,
        awb: awb.awb_code,
        courierName: awb.courier_name ?? "Shiprocket",
        trackingUrl: `https://shiprocket.co/tracking/${awb.awb_code}`,
      };
    },
  };
}

/** Courier status text from a tracking webhook, mapped to our order steps. */
export function orderStepForCourierStatus(status: string): "shipped" | "delivered" | null {
  const s = status.toUpperCase();
  if (s.includes("RTO") || s.includes("CANCEL") || s.includes("LOST") || s.includes("DAMAGE")) return null;
  if (s === "DELIVERED") return "delivered";
  if (
    [
      "PICKED UP",
      "SHIPPED",
      "IN TRANSIT",
      "OUT FOR DELIVERY",
      "REACHED AT DESTINATION HUB",
      "OUT FOR PICKUP",
    ].some((x) => s.includes(x))
  ) {
    return s.includes("OUT FOR PICKUP") ? null : "shipped";
  }
  return null;
}
