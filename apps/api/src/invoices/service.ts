import {
  BUSINESS,
  financialYear,
  GST,
  istDateOf,
  placeOfSupply,
  splitInclusive,
  stateForVisitCity,
  type Invoice as InvoiceDto,
} from "@happynails/shared";
import type { Logger } from "pino";
import { Booking, type BookingDoc } from "../models/Booking";
import { Invoice, type InvoiceAttrs } from "../models/Invoice";
import { Counter, Order, type OrderDoc } from "../models/Order";

const SUPPLIER = {
  legalName: BUSINESS.legalName,
  brand: BUSINESS.brand,
  gstin: BUSINESS.gstin,
  cin: BUSINESS.cin,
  address: [...BUSINESS.address.lines, `${BUSINESS.address.state} ${BUSINESS.address.pincode}`].join(", "),
  state: BUSINESS.address.state,
  stateCode: BUSINESS.stateCode,
};

async function nextNumber(prefix: "HN" | "HNCN", at: Date): Promise<string> {
  const fy = financialYear(istDateOf(at));
  const c = await Counter.findOneAndUpdate(
    { _id: `${prefix}-${fy}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return `${prefix}/${fy}/${String(c!.seq).padStart(5, "0")}`;
}

interface Part {
  description: string;
  hsnSac: string;
  qty: number;
  totalPaise: number;
}

function lines(parts: Part[], intraState: boolean) {
  const out = parts
    .filter((p) => p.totalPaise > 0)
    .map((p) => ({ ...p, ratePct: GST.ratePct, ...splitInclusive(p.totalPaise, GST.ratePct, intraState) }));
  const totals = out.reduce(
    (t, l) => ({
      taxablePaise: t.taxablePaise + l.taxablePaise,
      cgstPaise: t.cgstPaise + l.cgstPaise,
      sgstPaise: t.sgstPaise + l.sgstPaise,
      igstPaise: t.igstPaise + l.igstPaise,
      totalPaise: t.totalPaise + l.totalPaise,
    }),
    { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 },
  );
  return { lines: out, totals };
}

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000;

function orderInvoiceData(o: OrderDoc) {
  const pos = placeOfSupply(o.address.state);
  const parts: Part[] = [
    ...o.items.map((i) => ({
      description: `${i.name} press-on nails (${i.optionLabel})`,
      hsnSac: GST.codes.pressOnNails,
      qty: i.qty,
      totalPaise: i.unitPaise * i.qty,
    })),
    {
      description: `Delivery (${o.shippingSpeed})`,
      hsnSac: GST.codes.delivery,
      qty: 1,
      totalPaise: o.shippingPaise,
    },
  ];
  return {
    customer: {
      name: o.customer.name,
      phone: o.customer.phone,
      email: o.customer.email,
      address: `${o.address.line}, ${o.address.city} ${o.address.pincode}`,
      state: o.address.state,
    },
    pos,
    parts,
  };
}

function bookingInvoiceData(b: BookingDoc) {
  const state = stateForVisitCity(b.city);
  const addonTotal = b.addons.reduce((s, a) => s + a.pricePaise, 0);
  const parts: Part[] = [
    {
      description: `Home visit: ${b.serviceName}`,
      hsnSac: GST.codes.homeVisit,
      qty: 1,
      totalPaise: b.totalPaise - addonTotal,
    },
    ...b.addons.map((a) => ({
      description: `Add-on: ${a.name}`,
      hsnSac: GST.codes.homeVisit,
      qty: 1,
      totalPaise: a.pricePaise,
    })),
  ];
  return {
    customer: {
      name: b.customer.name,
      phone: b.customer.phone,
      address: `${b.address}, ${b.city} ${b.pincode}`,
      state,
    },
    pos: placeOfSupply(state),
    parts,
  };
}

/** Issues the tax invoice for a paid order, once. Returns the invoice number, or null if not paid. */
export async function ensureOrderInvoice(orderId: string, log?: Logger): Promise<string | null> {
  const existing = await Invoice.findOne({
    kind: "invoice",
    "source.type": "order",
    "source.id": orderId,
  }).lean();
  if (existing) return existing.number;
  const o = await Order.findById(orderId);
  if (!o || !["captured", "refunded"].includes(o.payment.status)) return null;
  const at = o.payment.paidAt ?? new Date();
  const { customer, pos, parts } = orderInvoiceData(o);
  const body = lines(parts, pos.intraState);
  try {
    const inv = await Invoice.create({
      number: await nextNumber("HN", at),
      kind: "invoice",
      issuedAt: at,
      source: { type: "order", id: o._id, number: o.number },
      supplier: SUPPLIER,
      customer,
      placeOfSupply: { state: pos.state, code: pos.code },
      intraState: pos.intraState,
      ...body,
      paymentNote: `Paid online (Razorpay ${o.payment.razorpayPaymentId ?? ""})`.trim(),
    });
    log?.info({ invoice: inv.number, order: o.number }, "tax invoice issued");
    return inv.number;
  } catch (err) {
    if (isDuplicate(err))
      return (await Invoice.findOne({ kind: "invoice", "source.id": orderId }).lean())?.number ?? null;
    throw err;
  }
}

/** Issues the tax invoice for a paid visit (online, or collected after the visit), once. */
export async function ensureBookingInvoice(bookingId: string, log?: Logger): Promise<string | null> {
  const existing = await Invoice.findOne({
    kind: "invoice",
    "source.type": "booking",
    "source.id": bookingId,
  }).lean();
  if (existing) return existing.number;
  const b = await Booking.findById(bookingId);
  if (!b || !["captured", "paid_after_visit", "refunded"].includes(b.payment.status)) return null;
  const at = b.payment.paidAt ?? new Date();
  const { customer, pos, parts } = bookingInvoiceData(b);
  const body = lines(parts, pos.intraState);
  try {
    const inv = await Invoice.create({
      number: await nextNumber("HN", at),
      kind: "invoice",
      issuedAt: at,
      source: { type: "booking", id: b._id, number: b.number },
      supplier: SUPPLIER,
      customer,
      placeOfSupply: { state: pos.state, code: pos.code },
      intraState: pos.intraState,
      ...body,
      paymentNote:
        b.payment.status === "paid_after_visit"
          ? "Paid after the visit (UPI or cash)"
          : `Paid online (Razorpay ${b.payment.razorpayPaymentId ?? ""})`.trim(),
    });
    log?.info({ invoice: inv.number, booking: b.number }, "tax invoice issued");
    return inv.number;
  } catch (err) {
    if (isDuplicate(err))
      return (await Invoice.findOne({ kind: "invoice", "source.id": bookingId }).lean())?.number ?? null;
    throw err;
  }
}

/**
 * A credit note for a refund, against the original invoice (issued first if missing).
 * The refund is treated as GST-inclusive, at the same rate and place of supply.
 */
export async function issueCreditNote(
  source: { type: "order" | "booking"; id: string },
  refund: { razorpayRefundId: string; amountPaise: number; reason: string; at: Date },
): Promise<string> {
  const invNumber =
    source.type === "order" ? await ensureOrderInvoice(source.id) : await ensureBookingInvoice(source.id);
  const inv = await Invoice.findOne({ number: invNumber }).lean();
  if (!inv) throw new Error(`No invoice to credit for ${source.type} ${source.id}`);
  const body = lines(
    [
      {
        description: `Refund: ${refund.reason}`,
        hsnSac: inv.lines[0]?.hsnSac ?? GST.codes.pressOnNails,
        qty: 1,
        totalPaise: refund.amountPaise,
      },
    ],
    inv.intraState,
  );
  try {
    const cn = await Invoice.create({
      number: await nextNumber("HNCN", refund.at),
      kind: "credit_note",
      againstNumber: inv.number,
      issuedAt: refund.at,
      source: { ...inv.source, refundId: refund.razorpayRefundId },
      supplier: inv.supplier,
      customer: inv.customer,
      placeOfSupply: inv.placeOfSupply,
      intraState: inv.intraState,
      ...body,
      paymentNote: `Refunded through Razorpay (${refund.razorpayRefundId})`,
    });
    return cn.number;
  } catch (err) {
    if (isDuplicate(err)) {
      return (await Invoice.findOne({
        kind: "credit_note",
        "source.refundId": refund.razorpayRefundId,
      }).lean())!.number;
    }
    throw err;
  }
}

export function toInvoiceDto(i: InvoiceAttrs): InvoiceDto {
  return {
    number: i.number,
    kind: i.kind,
    ...(i.againstNumber ? { againstNumber: i.againstNumber } : {}),
    issuedAt: i.issuedAt.toISOString(),
    source: { type: i.source.type, number: i.source.number },
    supplier: {
      legalName: i.supplier.legalName ?? "",
      brand: i.supplier.brand ?? "",
      gstin: i.supplier.gstin ?? "",
      cin: i.supplier.cin ?? "",
      address: i.supplier.address ?? "",
      state: i.supplier.state ?? "",
      stateCode: i.supplier.stateCode ?? "",
    },
    customer: {
      name: i.customer.name ?? "",
      phone: i.customer.phone ?? "",
      ...(i.customer.email ? { email: i.customer.email } : {}),
      address: i.customer.address ?? "",
      state: i.customer.state ?? "",
    },
    placeOfSupply: { state: i.placeOfSupply.state ?? "", code: i.placeOfSupply.code ?? "" },
    intraState: i.intraState,
    lines: i.lines.map((l) => ({
      description: l.description,
      hsnSac: l.hsnSac,
      qty: l.qty,
      ratePct: l.ratePct,
      taxablePaise: l.taxablePaise,
      cgstPaise: l.cgstPaise,
      sgstPaise: l.sgstPaise,
      igstPaise: l.igstPaise,
      totalPaise: l.totalPaise,
    })),
    totals: {
      taxablePaise: i.totals.taxablePaise,
      cgstPaise: i.totals.cgstPaise,
      sgstPaise: i.totals.sgstPaise,
      igstPaise: i.totals.igstPaise,
      totalPaise: i.totals.totalPaise,
    },
    paymentNote: i.paymentNote,
  };
}
