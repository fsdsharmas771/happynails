import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
}

/** The slice of the Razorpay SDK we use, so tests can substitute a fake. */
export interface RazorpayClient {
  payments: {
    refund(
      paymentId: string,
      input: { amount: number; notes: Record<string, string> },
    ): Promise<{ id: string; amount: number | string; status: string }>;
  };
  orders: {
    create(input: {
      amount: number;
      currency: "INR";
      receipt: string;
      notes: Record<string, string>;
    }): Promise<GatewayOrder>;
  };
}

export interface PaymentGateway {
  /** Public key id; safe to send to the browser. */
  readonly keyId: string;
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder>;
  /** Refunds part or all of a captured payment. */
  refund(input: { paymentId: string; amountPaise: number; notes: Record<string, string> }): Promise<{
    id: string;
    amountPaise: number;
    status: string;
  }>;
  /** Checkout callback: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Webhook: HMAC-SHA256 of the raw request body with the webhook secret. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Constant-time comparison of a computed hex digest with one supplied by a client. */
export function hexDigestMatches(expectedHex: string, givenHex: string): boolean {
  if (givenHex.length !== expectedHex.length || !/^[0-9a-f]+$/i.test(givenHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(givenHex, "hex"));
}

function hmacHex(secret: string, message: string | Buffer): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function createRazorpayGateway(config: RazorpayConfig, client?: RazorpayClient): PaymentGateway {
  const sdk: RazorpayClient =
    client ??
    (new Razorpay({ key_id: config.keyId, key_secret: config.keySecret }) as unknown as RazorpayClient);

  return {
    keyId: config.keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      const order = await sdk.orders.create({ amount: amountPaise, currency: "INR", receipt, notes });
      return { id: order.id, amount: Number(order.amount), currency: order.currency };
    },
    async refund({ paymentId, amountPaise, notes }) {
      const r = await sdk.payments.refund(paymentId, { amount: amountPaise, notes });
      return { id: r.id, amountPaise: Number(r.amount), status: r.status };
    },
    verifyPaymentSignature(orderId, paymentId, signature) {
      return hexDigestMatches(hmacHex(config.keySecret, `${orderId}|${paymentId}`), signature);
    },
    verifyWebhookSignature(rawBody, signature) {
      return hexDigestMatches(hmacHex(config.webhookSecret, rawBody), signature);
    },
  };
}
