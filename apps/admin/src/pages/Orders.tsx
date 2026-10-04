import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ORDER_STATUSES } from "@happynails/shared";
import { useIsOwner } from "../auth";
import { InvoiceLinks } from "./Gst";
import { Chip, Field, Message, PageHead } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatINR, label, parseRupees, when } from "../lib/format";
import type { Order, OrderList } from "../lib/types";

export function OrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? "1");
  const [search, setSearch] = useState(params.get("q") ?? "");

  const q = useQuery({
    queryKey: ["orders", status, params.get("q") ?? "", page],
    queryFn: () =>
      api.get<OrderList>(
        `/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(params.get("q") ? { q: params.get("q")! } : {}), page: String(page) })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const set = (next: Record<string, string>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      return p;
    });

  return (
    <>
      <PageHead title="Orders" />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim(), page: "" });
        }}
      >
        <Field label="Status">
          {(id) => (
            <select id={id} value={status} onChange={(e) => set({ status: e.target.value, page: "" })}>
              <option value="">All</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Search">
          {(id) => (
            <input
              id={id}
              placeholder="Number, name, phone or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </Field>
        <button className="btn sm ghost" type="submit">
          Search
        </button>
      </form>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  No orders match.
                </td>
              </tr>
            )}
            {q.data?.items.map((o) => (
              <tr key={o._id} className="click" onClick={() => navigate(`/orders/${o._id}`)}>
                <td>
                  <Link to={`/orders/${o._id}`} onClick={(e) => e.stopPropagation()}>
                    {o.number}
                  </Link>
                </td>
                <td>{when(o.createdAt)}</td>
                <td>{o.customer.name}</td>
                <td>
                  <Chip value={o.status} />
                </td>
                <td>
                  <Chip value={o.payment.status} />
                </td>
                <td className="num">{formatINR(o.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data && q.data.pages > 1 && (
        <div className="row">
          <button
            className="btn xs ghost"
            type="button"
            disabled={page <= 1}
            onClick={() => set({ page: String(page - 1) })}
          >
            Previous
          </button>
          <span className="note">
            Page {q.data.page} of {q.data.pages} ({q.data.total} orders)
          </span>
          <button
            className="btn xs ghost"
            type="button"
            disabled={page >= q.data.pages}
            onClick={() => set({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

const NEXT: Record<string, "packed" | "shipped" | "delivered" | undefined> = {
  placed: "packed",
  packed: "shipped",
  shipped: "delivered",
};

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const owner = useIsOwner();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api.get<Order>(`/orders/${id}`) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tracking, setTracking] = useState({ carrier: "", awb: "", url: "" });
  const [cancelNote, setCancelNote] = useState("");
  const [refund, setRefund] = useState({ amount: "", reason: "" });

  const act = useMutation({
    mutationFn: (fn: () => Promise<Order>) => fn(),
    onSuccess: (o) => {
      qc.setQueryData(["order", id], o);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setMsg({ ok: true, text: "Saved." });
    },
    onError: (err) => setMsg({ ok: false, text: errorText(err) }),
  });

  const o = q.data;
  if (q.isError) return <p className="msg no">That order could not be loaded.</p>;
  if (!o) return <p className="note">Loading</p>;

  const next = NEXT[o.status];
  const refunded = o.refunds.reduce((s, r) => s + r.amountPaise, 0);
  const canRefund = owner && o.payment.status === "captured";

  function saveTracking(e: FormEvent) {
    e.preventDefault();
    act.mutate(() => api.post<Order>(`/orders/${id}/tracking`, tracking));
  }

  return (
    <>
      <PageHead title={`Order ${o.number}`}>
        <Chip value={o.status} />
        <Link className="btn xs ghost" to="/orders">
          All orders
        </Link>
      </PageHead>
      <Message ok={msg?.ok}>{msg?.text}</Message>
      <div className="split">
        <div className="stack">
          <section className="panel">
            <h2>Items</h2>
            <div className="rows">
              {o.items.map((i) => (
                <div key={`${i.slug}${i.optionLabel}`}>
                  <span>
                    {i.name} &middot; {i.optionLabel} &times; {i.qty}
                  </span>
                  <span>{formatINR(i.unitPaise * i.qty)}</span>
                </div>
              ))}
              <div>
                <span>Delivery ({o.shippingSpeed})</span>
                <span>{o.shippingPaise ? formatINR(o.shippingPaise) : "Free"}</span>
              </div>
              <div className="t">
                <span>Total</span>
                <span>{formatINR(o.totalPaise)}</span>
              </div>
              {refunded > 0 && (
                <div>
                  <span>Refunded</span>
                  <span>&minus;{formatINR(refunded)}</span>
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>GST</h2>
            <InvoiceLinks source="order" id={o._id} />
          </section>
          <section className="panel">
            <h2>History</h2>
            <ol className="timeline">
              {o.events.map((e, k) => (
                <li key={k}>
                  <Chip value={e.status} /> {when(e.at)}
                  {e.note && <small>{e.note}</small>}
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <h2>Customer</h2>
            <dl className="kv">
              <dt>Name</dt>
              <dd>{o.customer.name}</dd>
              <dt>Phone</dt>
              <dd>{o.customer.phone}</dd>
              <dt>Email</dt>
              <dd>{o.customer.email}</dd>
              <dt>Address</dt>
              <dd>
                {o.address.line}, {o.address.city} {o.address.pincode}, {o.address.state}
              </dd>
              <dt>Payment</dt>
              <dd>
                <Chip value={o.payment.status} /> {o.payment.razorpayPaymentId ?? ""}
              </dd>
            </dl>
          </section>
          {next && (
            <section className="panel stack">
              <h2>Next step</h2>
              {(o.status === "placed" || o.status === "packed") && (
                <form className="stack" onSubmit={saveTracking}>
                  <div className="grid2">
                    <Field label="Courier">
                      {(fid) => (
                        <input
                          id={fid}
                          value={tracking.carrier}
                          placeholder={o.tracking?.carrier ?? ""}
                          onChange={(e) => setTracking((t) => ({ ...t, carrier: e.target.value }))}
                        />
                      )}
                    </Field>
                    <Field label="Tracking number">
                      {(fid) => (
                        <input
                          id={fid}
                          value={tracking.awb}
                          placeholder={o.tracking?.awb ?? ""}
                          onChange={(e) => setTracking((t) => ({ ...t, awb: e.target.value }))}
                        />
                      )}
                    </Field>
                  </div>
                  <Field label="Tracking link (optional)">
                    {(fid) => (
                      <input
                        id={fid}
                        type="url"
                        value={tracking.url}
                        placeholder={o.tracking?.url ?? ""}
                        onChange={(e) => setTracking((t) => ({ ...t, url: e.target.value }))}
                      />
                    )}
                  </Field>
                  <div>
                    <button className="btn xs ghost" type="submit" disabled={act.isPending}>
                      Save tracking
                    </button>
                  </div>
                </form>
              )}
              <div>
                <button
                  className="btn sm"
                  type="button"
                  disabled={act.isPending}
                  onClick={() => act.mutate(() => api.post<Order>(`/orders/${id}/status`, { status: next }))}
                >
                  Mark {label(next).toLowerCase()}
                </button>
              </div>
              {next === "shipped" && (
                <p className="note">The customer gets a message with the tracking details.</p>
              )}
            </section>
          )}
          {["pending_payment", "placed", "packed"].includes(o.status) && (
            <section className="panel stack">
              <h2>Cancel</h2>
              <Field label="Reason">
                {(fid) => (
                  <input id={fid} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
                )}
              </Field>
              <div>
                <button
                  className="btn xs danger"
                  type="button"
                  disabled={act.isPending || cancelNote.trim().length < 2}
                  onClick={() =>
                    act.mutate(() => api.post<Order>(`/orders/${id}/cancel`, { note: cancelNote }))
                  }
                >
                  Cancel order and return stock
                </button>
              </div>
              {o.payment.status === "captured" && (
                <p className="note">This order was paid online; refund it after cancelling.</p>
              )}
            </section>
          )}
          {canRefund && (
            <section className="panel stack">
              <h2>Refund</h2>
              <p className="note">
                Up to {formatINR(o.totalPaise - refunded)}. Goes back to the customer&rsquo;s original payment
                method.
              </p>
              <div className="grid2">
                <Field label="Amount (₹)" hint="Leave empty for the full amount">
                  {(fid) => (
                    <input
                      id={fid}
                      inputMode="decimal"
                      value={refund.amount}
                      onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))}
                    />
                  )}
                </Field>
                <Field label="Reason">
                  {(fid) => (
                    <input
                      id={fid}
                      value={refund.reason}
                      onChange={(e) => setRefund((r) => ({ ...r, reason: e.target.value }))}
                    />
                  )}
                </Field>
              </div>
              <div>
                <button
                  className="btn xs danger"
                  type="button"
                  disabled={act.isPending || refund.reason.trim().length < 2}
                  onClick={() => {
                    const amountPaise = refund.amount.trim() ? parseRupees(refund.amount) : undefined;
                    if (amountPaise === null) return setMsg({ ok: false, text: "Enter a valid amount." });
                    act.mutate(() =>
                      api.post<Order>(`/orders/${id}/refund`, {
                        reason: refund.reason,
                        ...(amountPaise ? { amountPaise } : {}),
                      }),
                    );
                  }}
                >
                  Refund through Razorpay
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
