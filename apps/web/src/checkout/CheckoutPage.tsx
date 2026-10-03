import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addressSchema,
  customerSchema,
  formatINR,
  INDIAN_STATES,
  type CreateOrderResponse,
  type ShippingSpeed,
} from "@happynails/shared";
import { LineThumb } from "../cart/LineThumb";
import { useCart } from "../cart/store";
import { useQuote } from "../cart/useQuote";
import { ApiError, api } from "../lib/api";
import { openRazorpay } from "../lib/razorpay";
import "../cart/cart.css";
import "../layout/overlays.css";

type FieldKey = "name" | "phone" | "email" | "line" | "pincode" | "city" | "state";
type Form = Record<FieldKey, string>;
const EMPTY: Form = { name: "", phone: "", email: "", line: "", pincode: "", city: "", state: "" };

/** Accepts pasted "+91 98765 43210" or "098765 43210" and keeps the 10-digit number. */
function normalizeMobile(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  else if (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

function validate(form: Form): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  const c = customerSchema.safeParse({ name: form.name, phone: form.phone, email: form.email });
  const a = addressSchema.safeParse({
    line: form.line,
    pincode: form.pincode,
    city: form.city,
    state: form.state,
  });
  for (const issue of [...(c.error?.issues ?? []), ...(a.error?.issues ?? [])]) {
    const key = issue.path[0] as FieldKey;
    errors[key] ??= issue.message;
  }
  return errors;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: (id: string, describedBy: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={`field${error ? " bad" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, `${id}-err`)}
      <div className="err" id={`${id}-err`} aria-live="polite">
        {error}
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  active,
  done,
  onEdit,
  summary,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  done: boolean;
  onEdit?: (() => void) | undefined;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`co-step${active ? "" : " dim"}`} aria-current={active ? "step" : undefined}>
      <h3>
        <i>{n}</i>
        {title}
        {done && onEdit && (
          <button className="tlink edit" type="button" onClick={onEdit}>
            Edit
          </button>
        )}
      </h3>
      {done && !active && summary ? <p className="done-note">{summary}</p> : null}
      <fieldset className="co-fields" disabled={!active}>
        {children}
      </fieldset>
    </section>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "ITEMS_UNAVAILABLE":
      case "OUT_OF_STOCK":
        return "A set in your bag just sold out. Your bag has been updated; please review it.";
      case "PAYMENTS_UNAVAILABLE":
        return "Online payment is not available right now. Please try again later.";
      case "PAYMENT_GATEWAY_ERROR":
        return "We could not start the payment. Please try again.";
      case "VALIDATION_ERROR":
        return "Please check your details.";
    }
  }
  return "Something went wrong. Please try again.";
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [speed, setSpeed] = useState<ShippingSpeed>("standard");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** Set once an order exists; from then on retries pay for this same order. */
  const [created, setCreated] = useState<CreateOrderResponse | null>(null);

  const quote = useQuote(speed);
  const q = quote.data;
  const eta = useQuery({
    queryKey: ["eta", form.pincode],
    queryFn: () => api.deliveryEstimate(form.pincode),
    enabled: step > 1 && /^\d{6}$/.test(form.pincode),
    staleTime: Infinity,
  });

  const set = (key: FieldKey) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function continueFromDetails() {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setStep(2);
  }

  const orderLink = (o: { orderNumber: string; trackToken: string }, paid = false) =>
    `/order/${o.orderNumber}?token=${encodeURIComponent(o.trackToken)}${paid ? "&paid=1" : ""}`;

  async function pay(order: CreateOrderResponse) {
    setMessage(null);
    const result = await openRazorpay(order.razorpay, {
      orderNumber: order.orderNumber,
      prefill: { name: form.name.trim(), email: form.email.trim(), contact: form.phone },
    }).catch(() => ({ kind: "failed" as const, reason: "The payment page could not be opened." }));

    if (result.kind === "success") {
      // The webhook confirms the order; this check only lets us say "payment received" straight away.
      await api.verifyPayment({ orderNumber: order.orderNumber, ...result.response }).catch(() => undefined);
      clearCart();
      navigate(orderLink(order, true), { replace: true });
      return;
    }
    setMessage({
      ok: false,
      text:
        result.kind === "failed"
          ? `${result.reason} Your order is held for 30 minutes, so you can try again.`
          : "Payment was not completed. Your order is held for 30 minutes, so you can try again.",
    });
  }

  async function placeOrder() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (created) {
        await pay(created);
        return;
      }
      const order = await api.createOrder({
        items,
        customer: { name: form.name.trim(), phone: form.phone, email: form.email.trim() },
        address: {
          line: form.line.trim(),
          pincode: form.pincode,
          city: form.city.trim(),
          state: form.state as (typeof INDIAN_STATES)[number],
        },
        shippingSpeed: speed,
      });
      setCreated(order);
      await pay(order);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "ITEMS_UNAVAILABLE" || err.code === "OUT_OF_STOCK")) {
        await qc.invalidateQueries({ queryKey: ["quote"] });
      }
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const top = (
    <div className="co-top">
      <Link className="brand" to="/" aria-label="Happy Nails, back to the shop">
        <span className="mono">HN</span>
        <span className="bn">Happy Nails</span>
      </Link>
      <span className="secure">
        <span className="lock" aria-hidden="true" />
        Secure checkout
      </span>
      <Link className="x" to="/" aria-label="Close checkout" />
    </div>
  );

  if (items.length === 0 && !created) {
    return (
      <div className="checkout">
        {top}
        <div className="co">
          <div className="empty-bag">
            <h2>Your bag is empty</h2>
            <Link className="btn" to="/#shop">
              Browse the collection
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const locked = !!created;
  const pricing = q?.pricing;
  const standardPrice =
    pricing && q && q.totals.subtotalPaise >= pricing.freeShippingThresholdPaise
      ? "Free"
      : pricing
        ? formatINR(pricing.standardShippingPaise)
        : "";

  return (
    <div className="checkout">
      {top}
      <div className="co">
        <div>
          <h2>Checkout</h2>

          <Step
            n={1}
            title="Delivery details"
            active={step === 1 && !locked}
            done={step > 1}
            onEdit={locked ? undefined : () => setStep(1)}
            summary={`${form.name}, ${form.city} ${form.pincode}`}
          >
            <div className="frm2">
              <Field label="Full name" error={errors.name}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => set("name")(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Mobile number" error={errors.phone}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="10 digits"
                    value={form.phone}
                    onChange={(e) => set("phone")(normalizeMobile(e.target.value))}
                  />
                )}
              </Field>
            </div>
            <Field label="Email for the receipt" error={errors.email}>
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set("email")(e.target.value)}
                />
              )}
            </Field>
            <Field label="Address" error={errors.line}>
              {(id, d) => (
                <textarea
                  id={id}
                  aria-describedby={d}
                  rows={2}
                  autoComplete="street-address"
                  value={form.line}
                  onChange={(e) => set("line")(e.target.value)}
                />
              )}
            </Field>
            <div className="frm2">
              <Field label="Pincode" error={errors.pincode}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="postal-code"
                    value={form.pincode}
                    onChange={(e) => set("pincode")(e.target.value.replace(/\D/g, ""))}
                  />
                )}
              </Field>
              <Field label="City" error={errors.city}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    autoComplete="address-level2"
                    value={form.city}
                    onChange={(e) => set("city")(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="State" error={errors.state}>
              {(id, d) => (
                <select
                  id={id}
                  aria-describedby={d}
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(e) => set("state")(e.target.value)}
                >
                  <option value="">Choose your state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div>
              <button className="btn" type="button" onClick={continueFromDetails}>
                Continue to delivery <span className="arrow" />
              </button>
            </div>
          </Step>

          <Step
            n={2}
            title="Delivery speed"
            active={step === 2 && !locked}
            done={step > 2}
            onEdit={locked ? undefined : () => setStep(2)}
            summary={speed === "express" ? "Express" : "Standard"}
          >
            <div className="opts" role="radiogroup" aria-label="Delivery speed">
              <label className="opt">
                <input
                  type="radio"
                  name="ship"
                  checked={speed === "standard"}
                  onChange={() => setSpeed("standard")}
                />
                <span className="t">
                  <b>Standard</b>
                  <span>{eta.data?.standard ?? "3 to 6 days"}</span>
                </span>
                <span className="pr">{standardPrice}</span>
              </label>
              <label className="opt">
                <input
                  type="radio"
                  name="ship"
                  checked={speed === "express"}
                  onChange={() => setSpeed("express")}
                />
                <span className="t">
                  <b>Express</b>
                  <span>{eta.data?.express ?? "1 to 3 days"}</span>
                </span>
                <span className="pr">{pricing ? formatINR(pricing.expressShippingPaise) : ""}</span>
              </label>
            </div>
            <div>
              <button className="btn" type="button" onClick={() => setStep(3)}>
                Continue to payment <span className="arrow" />
              </button>
            </div>
          </Step>

          <Step n={3} title="Payment" active={step === 3} done={false}>
            <div className="opt pay-online">
              <span className="lock" aria-hidden="true" />
              <span className="t">
                <b>Pay online</b>
                <span>UPI, cards and netbanking on Razorpay&rsquo;s secure page</span>
              </span>
              <span />
            </div>
            {q && !q.onlinePaymentAvailable && (
              <p className="msg no">Online payment is not available right now. Please try again later.</p>
            )}
            {created && (
              <p className="note">
                Order <b>{created.orderNumber}</b> is waiting for payment.
              </p>
            )}
            <div role="status" aria-live="polite">
              {message && <p className={`msg ${message.ok ? "ok" : "no"}`}>{message.text}</p>}
            </div>
            <div>
              <button
                className="btn"
                type="button"
                disabled={busy || !q || !q.allAvailable || !q.onlinePaymentAvailable || quote.isFetching}
                onClick={() => void placeOrder()}
              >
                {busy
                  ? "Working…"
                  : created
                    ? "Try payment again"
                    : `Pay ${q ? formatINR(q.totals.totalPaise) : ""}`}
              </button>
            </div>
          </Step>
        </div>

        <aside className="panel sum" aria-label="Order summary">
          <h4>Order summary</h4>
          {!q && quote.isPending && <p className="note">Pricing your bag</p>}
          {quote.isError && !q && <p className="msg no">Your bag could not be priced just now.</p>}
          {q && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {q.lines.map((l) => (
                  <div className="line" key={`${l.slug}|${l.option}`}>
                    <LineThumb product={l.product} />
                    <div>
                      <h4>{l.product?.name ?? "A removed set"}</h4>
                      <small>
                        {l.optionLabel} &middot; Qty {l.qty}
                      </small>
                      {!l.available && <small className="na">No longer available</small>}
                    </div>
                    <b>{l.available ? formatINR(l.linePaise) : "–"}</b>
                  </div>
                ))}
              </div>
              <div className="rows" aria-live="polite">
                <div>
                  <span>Subtotal</span>
                  <span>{formatINR(q.totals.subtotalPaise)}</span>
                </div>
                <div>
                  <span>Delivery</span>
                  <span>{q.totals.shippingPaise ? formatINR(q.totals.shippingPaise) : "Free"}</span>
                </div>
                <div className="t">
                  <span>Total</span>
                  <span>{formatINR(q.totals.totalPaise)}</span>
                </div>
              </div>
              {!q.allAvailable && (
                <p className="msg no">
                  Some sets are no longer available. <Link to="/">Return to your bag</Link> to remove them.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
