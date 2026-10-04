import { z } from "zod";
import { BUSINESS, GST_STATE_CODES } from "./business";
import type { VisitCity } from "./pincode";

/**
 * GST setup. Prices shown to customers include GST, as Indian consumer prices must.
 * CONFIRM WITH YOUR CA: the 18% rate and the HSN/SAC codes below are the usual ones for
 * press-on nails (cosmetics), courier charges and manicure services.
 */
export const GST = {
  ratePct: 18,
  codes: {
    pressOnNails: "3304",
    delivery: "996812",
    homeVisit: "999722",
  },
} as const;

export interface TaxSplit {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/**
 * Splits a GST-inclusive amount into taxable value and tax. Within the supplier's state the tax is
 * CGST + SGST (half each); across states it is IGST. Paise are kept whole and always add up.
 */
export function splitInclusive(totalPaise: number, ratePct: number, intraState: boolean): TaxSplit {
  const taxablePaise = Math.round((totalPaise * 100) / (100 + ratePct));
  const tax = totalPaise - taxablePaise;
  if (!intraState) return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise };
  const cgstPaise = Math.ceil(tax / 2);
  return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0, totalPaise };
}

/** A home visit is supplied where it is performed. */
export function stateForVisitCity(city: VisitCity): string {
  return city === "Delhi" ? "Delhi" : city === "Noida" ? "Uttar Pradesh" : "Haryana";
}

export function placeOfSupply(state: string): { state: string; code: string; intraState: boolean } {
  const code = GST_STATE_CODES[state] ?? "97";
  return { state, code, intraState: code === BUSINESS.stateCode };
}

/** Indian financial year (April to March) of an India calendar day, e.g. "26-27". */
export function financialYear(istDate: string): string {
  const y = Number(istDate.slice(0, 4));
  const start = Number(istDate.slice(5, 7)) >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

const paise = z.number().int();

export const invoiceLineSchema = z.object({
  description: z.string(),
  hsnSac: z.string(),
  qty: z.number().int(),
  ratePct: z.number(),
  taxablePaise: paise,
  cgstPaise: paise,
  sgstPaise: paise,
  igstPaise: paise,
  totalPaise: paise,
});

export const invoiceSchema = z.object({
  number: z.string(),
  kind: z.enum(["invoice", "credit_note"]),
  /** For credit notes: the invoice being credited. */
  againstNumber: z.string().optional(),
  issuedAt: z.string(),
  source: z.object({ type: z.enum(["order", "booking"]), number: z.string() }),
  supplier: z.object({
    legalName: z.string(),
    brand: z.string(),
    gstin: z.string(),
    cin: z.string(),
    address: z.string(),
    state: z.string(),
    stateCode: z.string(),
  }),
  customer: z.object({
    name: z.string(),
    phone: z.string(),
    email: z.string().optional(),
    address: z.string(),
    state: z.string(),
  }),
  placeOfSupply: z.object({ state: z.string(), code: z.string() }),
  intraState: z.boolean(),
  lines: z.array(invoiceLineSchema),
  totals: z.object({
    taxablePaise: paise,
    cgstPaise: paise,
    sgstPaise: paise,
    igstPaise: paise,
    totalPaise: paise,
  }),
  paymentNote: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;
