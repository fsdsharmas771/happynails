import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { InvoiceView } from "@happynails/ui";
import { ApiError, api } from "../lib/api";
import { useDocumentMeta } from "../lib/meta";

/** Printable GST invoice (and any credit notes) for an order or a visit, opened from the customer's link. */
export function InvoicePage() {
  const [params] = useSearchParams();
  const kind = params.get("for") === "booking" ? "booking" : "order";
  const number = params.get("number") ?? "";
  const token = params.get("token") ?? "";
  const q = useQuery({
    queryKey: ["invoice", kind, number, token],
    queryFn: () =>
      kind === "order" ? api.orderInvoice({ number, token }) : api.bookingInvoice({ number, token }),
    retry: false,
  });
  useDocumentMeta({ title: `Tax invoice for ${number} · Happy Nails` });

  const back =
    kind === "order" ? `/order/${encodeURIComponent(number)}?token=${encodeURIComponent(token)}` : "/";

  return (
    <div className="invoice-page">
      <div
        className="row no-print"
        style={{ display: "flex", gap: 12, justifyContent: "center", padding: "20px 0" }}
      >
        <Link className="btn ghost sm" to={back}>
          Back
        </Link>
        {q.data && (
          <button className="btn sm" type="button" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        )}
      </div>
      {q.isPending && (
        <p className="note" style={{ textAlign: "center" }}>
          Loading the invoice
        </p>
      )}
      {q.isError && (
        <p className="msg no" style={{ maxWidth: 560, margin: "0 auto" }}>
          {q.error instanceof ApiError && q.error.code === "INVOICE_NOT_READY"
            ? "The tax invoice is issued as soon as the payment is confirmed. Please check again in a minute."
            : "We could not find that invoice. Open it from your confirmation link."}
        </p>
      )}
      {q.data?.map((inv) => (
        <InvoiceView key={inv.number} invoice={inv} />
      ))}
    </div>
  );
}
