import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatINR, type OrderStatus, type TrackedOrder } from "@happynails/shared";
import { ApiError, api } from "../lib/api";
import { addDays, formatDay } from "../lib/dates";
import { openRazorpay } from "../lib/razorpay";
import "../cart/cart.css";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Order placed" },
  { status: "packed", label: "Packed with your prep kit" },
  { status: "shipped", label: "Shipped with a tracking link" },
  { status: "delivered", label: "Delivered" },
];

/** Stop polling for the webhook after about two minutes; the page can be refreshed later. */
const MAX_POLLS = 30;

function Timeline({ order }: { order: TrackedOrder }) {
  const reached = new Map(order.events.map((e) => [e.status, e.at]));
  const current = [...STEPS].reverse().find((s) => reached.has(s.status))?.status;
  const [lo, hi] = order.deliveryDays ?? [3, 6];
  const start = reached.get("placed") ?? order.placedAt;
  const express = order.shippingSpeed === "express";
  const window = `${formatDay(addDays(start, express ? Math.max(1, lo - 1) : lo))} to ${formatDay(
    addDays(start, express ? lo + 1 : hi),
  )}`;

  return (
    <ol className="track">
      {STEPS.map((s) => {
        const at = reached.get(s.status);
        const cls = s.status === current ? "now" : at ? "past" : "";
        return (
          <li key={s.status} className={cls} aria-current={s.status === current ? "step" : undefined}>
            <i aria-hidden="true" />
            <span>
              {s.label}
              <small>
                {at ? formatDay(at) : s.status === "delivered" ? `Expected ${window}` : "Not yet"}
              </small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Totals({ order }: { order: TrackedOrder }) {
  const t = order.totals;
  return (
    <div className="rows">
      {order.items.map((i, k) => (
        <div key={k}>
          <span>
            {i.name} &middot; {i.optionLabel} &times; {i.qty}
          </span>
          <span>{formatINR(i.linePaise)}</span>
        </div>
      ))}
      <div className="t" style={{ fontSize: 14, fontWeight: 400 }}>
        <span>Subtotal</span>
        <span>{formatINR(t.subtotalPaise)}</span>
      </div>
      <div>
        <span>Delivery</span>
        <span>{t.shippingPaise ? formatINR(t.shippingPaise) : "Free"}</span>
      </div>
      {t.codFeePaise > 0 && (
        <div>
          <span>Cash on delivery fee</span>
          <span>{formatINR(t.codFeePaise)}</span>
        </div>
      )}
      <div className="t">
        <span>Total</span>
        <span>{formatINR(t.totalPaise)}</span>
      </div>
    </div>
  );
}

export function OrderPage() {
  const { number = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const token = params.get("token") ?? "";
  const paid = params.get("paid") === "1";
  const [polls, setPolls] = useState(0);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const order = useQuery({
    queryKey: ["order", number, token],
    queryFn: async () => {
      setPolls((n) => n + 1);
      return api.trackOrder({ number, token });
    },
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "pending_payment" && polls < MAX_POLLS ? 4000 : false),
  });

  async function completePayment(o: TrackedOrder) {
    setPaying(true);
    setPayMsg(null);
    try {
      const { razorpay } = await api.resumePayment({ number, token });
      const result = await openRazorpay(razorpay, {
        orderNumber: number,
        prefill: { name: o.firstName, email: "", contact: "" },
      });
      if (result.kind === "success") {
        await api.verifyPayment({ orderNumber: number, ...result.response }).catch(() => undefined);
        setPolls(0);
        setParams((p) => {
          p.set("paid", "1");
          return p;
        });
        await order.refetch();
      } else {
        setPayMsg(
          result.kind === "failed" ? `${result.reason}. You can try again.` : "Payment was not completed.",
        );
      }
    } catch (err) {
      setPayMsg(
        err instanceof ApiError && err.code === "ORDER_NOT_PAYABLE"
          ? "This order is no longer waiting for payment."
          : "The payment page could not be opened. Please try again.",
      );
      await order.refetch();
    } finally {
      setPaying(false);
    }
  }

  if (order.isPending) {
    return (
      <section className="sec">
        <p className="note">Finding your order</p>
      </section>
    );
  }

  if (order.isError || !order.data) {
    const missing = order.error instanceof ApiError && order.error.status === 404;
    return (
      <section className="sec" aria-labelledby="oH">
        <div className="order-done">
          <p className="eyebrow">Order</p>
          <h1 className="h2" id="oH">
            {missing ? "We could not find that order." : "Your order could not be loaded."}
          </h1>
          <p style={{ color: "var(--muted)", maxWidth: "46ch" }}>
            {missing
              ? "Open the link from your confirmation message, or message us on WhatsApp with your order number."
              : "Please refresh the page in a moment."}
          </p>
          <Link className="btn ghost" to="/">
            Back to the shop
          </Link>
        </div>
      </section>
    );
  }

  const o = order.data;
  const waiting = o.status === "pending_payment";

  let heading: ReactNode;
  let lead: string;
  if (waiting && paid) {
    heading = <>Payment received.</>;
    lead =
      polls >= MAX_POLLS
        ? "We are still confirming your order with the bank. Refresh this page in a few minutes."
        : "We are confirming your order with the bank. This page updates on its own.";
  } else if (waiting) {
    heading = <>Your order is waiting for payment.</>;
    lead =
      o.paymentStatus === "failed"
        ? "Your last payment attempt did not go through. Your sets are held for 30 minutes from when you ordered."
        : "Your sets are held for 30 minutes from when you ordered.";
  } else if (o.status === "cancelled") {
    heading = <>This order was cancelled.</>;
    lead = "No payment was taken for it. You are welcome to order again.";
  } else {
    heading = (
      <>
        Thank you, <span>{o.firstName}</span>.
      </>
    );
    lead = "Keep this page's link to check on your order. We will also message you when it ships.";
  }

  return (
    <section className="sec" aria-labelledby="oH">
      <div className="co" style={{ padding: 0 }}>
        <div className="order-done">
          <p className="eyebrow">
            {waiting ? "Order held" : o.status === "cancelled" ? "Order" : "Order placed"}
          </p>
          <h1 className="h2" id="oH" aria-live="polite">
            {heading}
          </h1>
          <div className="ref">{o.number}</div>
          <p style={{ color: "var(--muted)", maxWidth: "46ch" }} aria-live="polite">
            {lead}
          </p>
          {waiting && !paid && (
            <>
              <button className="btn" type="button" disabled={paying} onClick={() => void completePayment(o)}>
                {paying ? "Opening payment…" : `Pay ${formatINR(o.totals.totalPaise)}`}
              </button>
              {payMsg && (
                <p className="msg no" role="status">
                  {payMsg}
                </p>
              )}
            </>
          )}
          {!waiting && o.status !== "cancelled" && <Timeline order={o} />}
          {o.tracking?.url && (
            <a className="btn ghost" href={o.tracking.url} target="_blank" rel="noopener noreferrer">
              Track with {o.tracking.carrier ?? "the courier"}
            </a>
          )}
          <Link className="btn ghost" to="/">
            Back to the site
          </Link>
        </div>
        <aside className="panel sum" aria-label="Order summary">
          <h4>{o.paymentMethod === "cod" ? "Cash on delivery" : "Paid online"}</h4>
          <p className="note">
            {o.paymentMethod === "cod"
              ? "Pay the courier when your order arrives."
              : o.paymentStatus === "captured"
                ? "Paid on Razorpay's secure page."
                : "Payment is handled on Razorpay's secure page."}
          </p>
          <Totals order={o} />
        </aside>
      </div>
    </section>
  );
}
