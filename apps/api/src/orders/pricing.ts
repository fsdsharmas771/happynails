import type {
  CartItem,
  PaymentMethod,
  QuoteLine,
  QuoteResponse,
  ShippingSpeed,
  Totals,
} from "@happynails/shared";
import type { Types } from "mongoose";
import { SIZING_OPTIONS } from "../config/catalogue";
import { PRICING } from "../config/checkout";
import { Product } from "../models/Product";

/** Delivery and COD charges for a subtotal. Pure, so the rules are easy to test. */
export function computeTotals(subtotalPaise: number, speed: ShippingSpeed, method: PaymentMethod): Totals {
  const shippingPaise =
    speed === "express"
      ? PRICING.expressShippingPaise
      : subtotalPaise >= PRICING.freeShippingThresholdPaise
        ? 0
        : PRICING.standardShippingPaise;
  const codFeePaise = method === "cod" ? PRICING.codFeePaise : 0;
  return {
    subtotalPaise,
    shippingPaise,
    codFeePaise,
    totalPaise: subtotalPaise + shippingPaise + codFeePaise,
  };
}

/** Same set and option twice in one request become one line. */
export function mergeLines(items: CartItem[]): CartItem[] {
  const merged = new Map<string, CartItem>();
  for (const i of items) {
    const key = `${i.slug}|${i.option}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, qty: prev.qty + i.qty } : { ...i });
  }
  return [...merged.values()];
}

export interface PricedLine extends QuoteLine {
  productId: Types.ObjectId | null;
}

export interface PricedCart {
  lines: PricedLine[];
  totals: Totals;
  allAvailable: boolean;
}

/** Prices a cart from the database. Unavailable lines are flagged and left out of the totals. */
export async function priceCart(
  items: CartItem[],
  speed: ShippingSpeed,
  method: PaymentMethod,
): Promise<PricedCart> {
  const wanted = mergeLines(items);
  const products = await Product.find({ slug: { $in: [...new Set(wanted.map((i) => i.slug))] } }).lean();
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  // Stock is per set, shared across sizing options.
  const qtyBySlug = new Map<string, number>();
  for (const i of wanted) qtyBySlug.set(i.slug, (qtyBySlug.get(i.slug) ?? 0) + i.qty);

  const lines: PricedLine[] = wanted.map((i) => {
    const p = bySlug.get(i.slug);
    const option = SIZING_OPTIONS.find((o) => o.key === i.option)!;
    const unitPaise = (p?.pricePaise ?? 0) + option.pricePaise;
    const available = !!p && p.active && p.stock >= (qtyBySlug.get(i.slug) ?? 0);
    const image = p?.images[0];
    return {
      productId: p?._id ?? null,
      slug: i.slug,
      option: i.option,
      qty: i.qty,
      available,
      product: p
        ? {
            name: p.name,
            shape: p.shape,
            finish: p.finish,
            color: p.color,
            ...(p.color2 ? { color2: p.color2 } : {}),
            ...(image ? { image: { url: image.url, alt: image.alt ?? "" } } : {}),
          }
        : null,
      optionLabel: option.label,
      unitPaise,
      linePaise: unitPaise * i.qty,
    };
  });

  const subtotal = lines.filter((l) => l.available).reduce((s, l) => s + l.linePaise, 0);
  return {
    lines,
    totals: computeTotals(subtotal, speed, method),
    allAvailable: lines.every((l) => l.available),
  };
}

export function toQuoteResponse(cart: PricedCart, paymentMethods: PaymentMethod[]): QuoteResponse {
  return {
    lines: cart.lines.map(({ productId: _id, ...line }) => line),
    totals: cart.totals,
    allAvailable: cart.allAvailable,
    pricing: { ...PRICING },
    paymentMethods,
  };
}
