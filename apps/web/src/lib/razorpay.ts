import type { RazorpayCheckout } from "@happynails/shared";

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type CheckoutResult =
  { kind: "success"; response: RazorpaySuccess } | { kind: "dismissed" } | { kind: "failed"; reason: string };

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (resp: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

let loading: Promise<RazorpayCtor> | null = null;

/** Loads Razorpay's checkout.js on demand, once. */
function loadRazorpay(): Promise<RazorpayCtor> {
  const existing = (window as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => {
      const ctor = (window as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Razorpay did not load"));
    };
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("Could not reach the payment page"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens Razorpay Checkout for an order created by our API. Card, UPI and bank details are typed
 * into Razorpay's own window; this page never sees them.
 */
export async function openRazorpay(
  checkout: RazorpayCheckout,
  opts: { orderNumber: string; prefill: { name: string; email: string; contact: string } },
): Promise<CheckoutResult> {
  const Razorpay = await loadRazorpay();
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2E2B2B";

  return new Promise((resolve) => {
    let failure: string | null = null;
    const rzp = new Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: "Happy Nails",
      description: `Order ${opts.orderNumber}`,
      prefill: { ...opts.prefill, contact: `+91${opts.prefill.contact}` },
      theme: { color: accent },
      handler: (response: RazorpaySuccess) => resolve({ kind: "success", response }),
      modal: {
        // Razorpay keeps the window open after a failure so the customer can retry inside it;
        // when they close it we report the last failure, if any.
        ondismiss: () => resolve(failure ? { kind: "failed", reason: failure } : { kind: "dismissed" }),
      },
    });
    rzp.on("payment.failed", (resp) => {
      failure = resp.error?.description ?? "The payment did not go through";
    });
    rzp.open();
  });
}
