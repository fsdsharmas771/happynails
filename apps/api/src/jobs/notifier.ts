import type { Logger } from "pino";
import type { WhatsAppMessage } from "../config/whatsapp";

/** Customer messages go out on WhatsApp only (owner decision, 2026-10-04: no email). */
export interface Notifier {
  sendWhatsApp(to: string, message: WhatsAppMessage): Promise<void>;
}

const mask = (n: string) => `******${n.slice(-4)}`;

/** Development notifier: logs what would be sent, with the number masked. */
export function createLogNotifier(log: Logger): Notifier {
  return {
    async sendWhatsApp(to, message) {
      log.info(
        { to: mask(to), template: message.template, message: message.text },
        "whatsapp (not sent: log notifier)",
      );
    },
  };
}

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  language: string;
}

/**
 * Meta WhatsApp Cloud API: sends an approved template message.
 * POST https://graph.facebook.com/{version}/{phone-number-id}/messages
 * Errors throw so the job queue retries; the token is never logged.
 */
export function createWhatsAppCloudNotifier(
  cfg: WhatsAppCloudConfig,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Notifier {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
  return {
    async sendWhatsApp(to, message) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: message.template,
            language: { code: cfg.language },
            components: [
              { type: "body", parameters: message.params.map((text) => ({ type: "text", text })) },
            ],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: number };
        } | null;
        throw new Error(
          `WhatsApp API ${res.status}${body?.error?.code ? ` (${body.error.code})` : ""}: ${body?.error?.message ?? res.statusText}`,
        );
      }
      const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
      log.info(
        { to: mask(to), template: message.template, messageId: body?.messages?.[0]?.id },
        "whatsapp sent",
      );
    },
  };
}
