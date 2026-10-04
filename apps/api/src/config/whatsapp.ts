/**
 * WhatsApp message templates. Meta only allows a business to start a conversation with an approved
 * template, so each of these must be created in WhatsApp Manager (category: Utility, language
 * English) with exactly this body text; {{1}}, {{2}}... are filled in by the API in this order.
 */
export const WHATSAPP_TEMPLATES = {
  order_placed: {
    name: "hn_order_placed",
    body: "Hi {{1}}, thank you for your Happy Nails order {{2}} of {{3}}. We will message you when it ships.",
  },
  order_shipped: {
    name: "hn_order_shipped",
    body: "Hi {{1}}, your Happy Nails order {{2}} has shipped with {{3}}. Track it here: {{4}}",
  },
  booking_confirmed: {
    name: "hn_visit_confirmed",
    body: "Hi {{1}}, your Happy Nails home visit {{2}} is confirmed for {{3}} in {{4}}. {{5}}",
  },
  booking_reminder: {
    name: "hn_visit_reminder",
    body: "Hi {{1}}, a reminder that your Happy Nails home visit is tomorrow, {{2}}. Reply here if you need to change it.",
  },
  booking_cancelled: {
    name: "hn_visit_cancelled",
    body: "Hi {{1}}, your Happy Nails home visit {{2}} on {{3}} has been cancelled. Message us here to book another time.",
  },
} as const;

export type TemplateKey = keyof typeof WHATSAPP_TEMPLATES;

export interface WhatsAppMessage {
  template: string;
  params: string[];
  /** The message as the customer reads it, for logs in development. */
  text: string;
}

/** Template parameters may not contain new lines, tabs or long runs of spaces (Meta rule). */
const clean = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim() || "-";

export function buildMessage(key: TemplateKey, params: string[]): WhatsAppMessage {
  const t = WHATSAPP_TEMPLATES[key];
  const values = params.map(clean);
  return {
    template: t.name,
    params: values,
    text: t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] ?? ""),
  };
}

/** Indian 10-digit mobile to the international form WhatsApp expects ("91XXXXXXXXXX"). */
export const toWhatsAppNumber = (mobile: string) => `91${mobile.replace(/\D/g, "").slice(-10)}`;
