import { addIstDays, daysOfMonth, istDateOf, istToUtc } from "@happynails/shared";
import { Invoice } from "../models/Invoice";

interface Amounts {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}
const zero = (): Amounts => ({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 });
function add(into: Amounts, a: Amounts, sign: 1 | -1) {
  into.taxablePaise += sign * a.taxablePaise;
  into.cgstPaise += sign * a.cgstPaise;
  into.sgstPaise += sign * a.sgstPaise;
  into.igstPaise += sign * a.igstPaise;
  into.totalPaise += sign * a.totalPaise;
}

async function documentsFor(month: string) {
  const dates = daysOfMonth(month);
  return Invoice.find({
    issuedAt: {
      $gte: istToUtc(dates[0]!, "00:00"),
      $lt: istToUtc(addIstDays(dates[dates.length - 1]!, 1), "00:00"),
    },
  })
    .sort({ issuedAt: 1, number: 1 })
    .lean();
}

/**
 * Monthly GST summary for filing (GSTR-1 style): totals, by place of supply, and by HSN/SAC.
 * Credit notes count as negative amounts in the month they are issued.
 */
export async function gstReport(month: string) {
  const docs = await documentsFor(month);
  const summary = { invoices: 0, creditNotes: 0, ...zero() };
  const byState = new Map<string, { state: string; code: string } & Amounts>();
  const byHsn = new Map<string, { hsnSac: string; ratePct: number; qty: number } & Amounts>();

  for (const d of docs) {
    const sign = d.kind === "credit_note" ? -1 : 1;
    if (sign === 1) summary.invoices++;
    else summary.creditNotes++;
    add(summary, d.totals, sign);
    const st = byState.get(d.placeOfSupply.code ?? "") ?? {
      state: d.placeOfSupply.state ?? "",
      code: d.placeOfSupply.code ?? "",
      ...zero(),
    };
    add(st, d.totals, sign);
    byState.set(st.code, st);
    for (const l of d.lines) {
      const key = `${l.hsnSac}|${l.ratePct}`;
      const h = byHsn.get(key) ?? { hsnSac: l.hsnSac, ratePct: l.ratePct, qty: 0, ...zero() };
      h.qty += sign * l.qty;
      add(h, l, sign);
      byHsn.set(key, h);
    }
  }

  return {
    month,
    summary,
    byState: [...byState.values()].sort((a, b) => a.code.localeCompare(b.code)),
    byHsn: [...byHsn.values()].sort((a, b) => a.hsnSac.localeCompare(b.hsnSac)),
    documents: docs.map((d) => {
      const sign = d.kind === "credit_note" ? -1 : 1;
      return {
        number: d.number,
        kind: d.kind,
        againstNumber: d.againstNumber ?? "",
        date: istDateOf(d.issuedAt),
        source: `${d.source.type} ${d.source.number}`,
        customerName: d.customer.name ?? "",
        placeOfSupply: `${d.placeOfSupply.state} (${d.placeOfSupply.code})`,
        taxablePaise: sign * d.totals.taxablePaise,
        cgstPaise: sign * d.totals.cgstPaise,
        sgstPaise: sign * d.totals.sgstPaise,
        igstPaise: sign * d.totals.igstPaise,
        totalPaise: sign * d.totals.totalPaise,
      };
    }),
  };
}

const rupees = (paise: number) => (paise / 100).toFixed(2);
const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote fields with commas or quotes, and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One row per invoice line, ready for a spreadsheet or the CA. */
export async function gstCsv(month: string): Promise<string> {
  const docs = await documentsFor(month);
  const header = [
    "Date",
    "Document number",
    "Type",
    "Against invoice",
    "Source",
    "Customer",
    "Place of supply",
    "State code",
    "HSN/SAC",
    "Description",
    "Qty",
    "GST rate %",
    "Taxable value",
    "CGST",
    "SGST",
    "IGST",
    "Total",
  ];
  const rows = [header.join(",")];
  for (const d of docs) {
    const sign = d.kind === "credit_note" ? -1 : 1;
    for (const l of d.lines) {
      rows.push(
        [
          istDateOf(d.issuedAt),
          d.number,
          d.kind === "credit_note" ? "Credit note" : "Tax invoice",
          d.againstNumber ?? "",
          `${d.source.type} ${d.source.number}`,
          d.customer.name ?? "",
          d.placeOfSupply.state ?? "",
          d.placeOfSupply.code ?? "",
          l.hsnSac,
          l.description,
          sign * l.qty,
          l.ratePct,
          rupees(sign * l.taxablePaise),
          rupees(sign * l.cgstPaise),
          rupees(sign * l.sgstPaise),
          rupees(sign * l.igstPaise),
          rupees(sign * l.totalPaise),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}
