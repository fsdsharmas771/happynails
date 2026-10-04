import { formatINR, type Invoice } from "@happynails/shared";
import "./invoice.css";

const money = (paise: number) => formatINR(Math.abs(paise)).replace("₹", "₹ ");
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

/** A GST tax invoice or credit note, laid out for the screen and for printing to PDF. */
export function InvoiceView({ invoice }: { invoice: Invoice }) {
  const credit = invoice.kind === "credit_note";
  const t = invoice.totals;
  return (
    <article className="invoice" aria-label={`${credit ? "Credit note" : "Tax invoice"} ${invoice.number}`}>
      <header className="inv-head">
        <div>
          <p className="inv-brand">{invoice.supplier.brand}</p>
          <p>
            <b>{invoice.supplier.legalName}</b>
          </p>
          <p>{invoice.supplier.address}</p>
          <p>
            GSTIN {invoice.supplier.gstin} · CIN {invoice.supplier.cin}
          </p>
        </div>
        <div className="inv-title">
          <h1>{credit ? "Credit note" : "Tax invoice"}</h1>
          <dl>
            <dt>Number</dt>
            <dd>{invoice.number}</dd>
            <dt>Date</dt>
            <dd>{day(invoice.issuedAt)}</dd>
            {invoice.againstNumber && (
              <>
                <dt>Against invoice</dt>
                <dd>{invoice.againstNumber}</dd>
              </>
            )}
            <dt>{invoice.source.type === "order" ? "Order" : "Booking"}</dt>
            <dd>{invoice.source.number}</dd>
          </dl>
        </div>
      </header>

      <section className="inv-parties">
        <div>
          <p className="inv-lbl">Billed to</p>
          <p>
            <b>{invoice.customer.name}</b>
          </p>
          <p>{invoice.customer.address}</p>
          <p>{invoice.customer.state}</p>
          <p>
            {invoice.customer.phone}
            {invoice.customer.email ? ` · ${invoice.customer.email}` : ""}
          </p>
        </div>
        <div>
          <p className="inv-lbl">Place of supply</p>
          <p>
            {invoice.placeOfSupply.state} ({invoice.placeOfSupply.code})
          </p>
          <p className="inv-lbl">Tax</p>
          <p>{invoice.intraState ? "CGST + SGST (within state)" : "IGST (inter-state)"}</p>
        </div>
      </section>

      <div className="inv-tablewrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>HSN/SAC</th>
              <th className="n">Qty</th>
              <th className="n">Taxable value</th>
              {invoice.intraState ? (
                <>
                  <th className="n">CGST</th>
                  <th className="n">SGST</th>
                </>
              ) : (
                <th className="n">IGST</th>
              )}
              <th className="n">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td>{l.hsnSac}</td>
                <td className="n">{l.qty}</td>
                <td className="n">{money(l.taxablePaise)}</td>
                {invoice.intraState ? (
                  <>
                    <td className="n">
                      {money(l.cgstPaise)}
                      <small> @{l.ratePct / 2}%</small>
                    </td>
                    <td className="n">
                      {money(l.sgstPaise)}
                      <small> @{l.ratePct / 2}%</small>
                    </td>
                  </>
                ) : (
                  <td className="n">
                    {money(l.igstPaise)}
                    <small> @{l.ratePct}%</small>
                  </td>
                )}
                <td className="n">{money(l.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{credit ? "Total credited" : "Total"}</td>
              <td className="n">{money(t.taxablePaise)}</td>
              {invoice.intraState ? (
                <>
                  <td className="n">{money(t.cgstPaise)}</td>
                  <td className="n">{money(t.sgstPaise)}</td>
                </>
              ) : (
                <td className="n">{money(t.igstPaise)}</td>
              )}
              <td className="n">
                <b>{money(t.totalPaise)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <footer className="inv-foot">
        <p>{invoice.paymentNote}</p>
        <p>Prices include GST. This is a computer-generated document and needs no signature.</p>
      </footer>
    </article>
  );
}
