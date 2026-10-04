import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { istDateOf, type Invoice } from "@happynails/shared";
import { InvoiceView } from "@happynails/ui";
import { Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatINR } from "../lib/format";

interface Amounts {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}
interface Report {
  month: string;
  summary: { invoices: number; creditNotes: number } & Amounts;
  byState: ({ state: string; code: string } & Amounts)[];
  byHsn: ({ hsnSac: string; ratePct: number; qty: number } & Amounts)[];
  documents: ({
    number: string;
    kind: "invoice" | "credit_note";
    againstNumber: string;
    date: string;
    source: string;
    customerName: string;
    placeOfSupply: string;
  } & Amounts)[];
}

const inr = (p: number) => (p < 0 ? `−${formatINR(-p)}` : formatINR(p));

function AmountCells({ a }: { a: Amounts }) {
  return (
    <>
      <td className="num">{inr(a.taxablePaise)}</td>
      <td className="num">{inr(a.cgstPaise)}</td>
      <td className="num">{inr(a.sgstPaise)}</td>
      <td className="num">{inr(a.igstPaise)}</td>
      <td className="num">{inr(a.totalPaise)}</td>
    </>
  );
}
const AMOUNT_HEADS = ["Taxable value", "CGST", "SGST", "IGST", "Total"];

export function GstPage() {
  const [month, setMonth] = useState(istDateOf(new Date()).slice(0, 7));
  const [dlError, setDlError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["gst", month], queryFn: () => api.get<Report>(`/gst?month=${month}`) });
  const r = q.data;

  async function downloadCsv() {
    setDlError(null);
    try {
      const res = await fetch(`/api/admin/gst.csv?month=${month}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `happy-nails-gst-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDlError("The CSV could not be downloaded. Please try again.");
    }
  }

  return (
    <>
      <PageHead title="GST">
        <input
          type="month"
          aria-label="Month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
        <button className="btn sm ghost" type="button" onClick={() => void downloadCsv()}>
          Download CSV
        </button>
      </PageHead>
      <p className="note">
        Tax invoices are issued when an order or visit is paid; refunds issue credit notes, shown as negative
        amounts. Prices include GST at 18%. Have your CA confirm the rate and HSN/SAC codes.
      </p>
      <Message>{dlError}</Message>
      {q.isError && <Message>{errorText(q.error)}</Message>}
      {r && (
        <>
          <div className="cards">
            <div className="stat">
              <span className="lbl">Taxable value</span>
              <b>{inr(r.summary.taxablePaise)}</b>
            </div>
            <div className="stat">
              <span className="lbl">CGST + SGST</span>
              <b>{inr(r.summary.cgstPaise + r.summary.sgstPaise)}</b>
            </div>
            <div className="stat">
              <span className="lbl">IGST</span>
              <b>{inr(r.summary.igstPaise)}</b>
            </div>
            <div className="stat">
              <span className="lbl">Documents</span>
              <b>{r.summary.invoices}</b>
              <span className="note">
                invoices, {r.summary.creditNotes} credit note{r.summary.creditNotes === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <h2 className="lbl">By place of supply</h2>
          <div className="tablewrap">
            <table className="t">
              <thead>
                <tr>
                  <th>State</th>
                  {AMOUNT_HEADS.map((h) => (
                    <th key={h} className="num">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.byState.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-row">
                      Nothing this month.
                    </td>
                  </tr>
                )}
                {r.byState.map((s) => (
                  <tr key={s.code}>
                    <td>
                      {s.state} ({s.code})
                    </td>
                    <AmountCells a={s} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="lbl">By HSN / SAC</h2>
          <div className="tablewrap">
            <table className="t">
              <thead>
                <tr>
                  <th>HSN/SAC</th>
                  <th className="num">Rate</th>
                  <th className="num">Qty</th>
                  {AMOUNT_HEADS.map((h) => (
                    <th key={h} className="num">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.byHsn.map((h) => (
                  <tr key={`${h.hsnSac}${h.ratePct}`}>
                    <td>{h.hsnSac}</td>
                    <td className="num">{h.ratePct}%</td>
                    <td className="num">{h.qty}</td>
                    <AmountCells a={h} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="lbl">Invoices and credit notes</h2>
          <div className="tablewrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Number</th>
                  <th>For</th>
                  <th>Customer</th>
                  <th>Place of supply</th>
                  {AMOUNT_HEADS.map((h) => (
                    <th key={h} className="num">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.documents.map((d) => (
                  <tr key={d.number}>
                    <td>{d.date}</td>
                    <td>
                      <Link to={`/invoice?number=${encodeURIComponent(d.number)}`}>{d.number}</Link>
                      {d.kind === "credit_note" && (
                        <div className="note">Credit note on {d.againstNumber}</div>
                      )}
                    </td>
                    <td>{d.source}</td>
                    <td>{d.customerName}</td>
                    <td>{d.placeOfSupply}</td>
                    <AmountCells a={d} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** One invoice or credit note, printable. */
export function InvoiceAdminPage() {
  const [params] = useSearchParams();
  const number = params.get("number") ?? "";
  const q = useQuery({
    queryKey: ["invoice", number],
    queryFn: () => api.get<Invoice[]>(`/invoices?number=${encodeURIComponent(number)}`),
  });
  return (
    <>
      <div className="row no-print">
        <Link className="btn xs ghost" to="/gst">
          GST report
        </Link>
        <button className="btn xs" type="button" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      {q.data?.length === 0 && <p className="note">No such invoice.</p>}
      {q.data?.map((inv) => (
        <InvoiceView key={inv.number} invoice={inv} />
      ))}
    </>
  );
}

/** Invoice links for an order or booking page. */
export function InvoiceLinks({ source, id }: { source: "order" | "booking"; id: string }) {
  const q = useQuery({
    queryKey: ["invoices", source, id],
    queryFn: () => api.get<Invoice[]>(`/invoices?source=${source}&sourceId=${id}`),
  });
  if (!q.data?.length)
    return <p className="note">No tax invoice yet: it is issued when payment is received.</p>;
  return (
    <ul className="timeline">
      {q.data.map((inv) => (
        <li key={inv.number}>
          <Link to={`/invoice?number=${encodeURIComponent(inv.number)}`}>
            {inv.kind === "credit_note" ? "Credit note" : "Tax invoice"} {inv.number}
          </Link>{" "}
          · {formatINR(inv.totals.totalPaise)}
        </li>
      ))}
    </ul>
  );
}
