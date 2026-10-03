import type { Logger } from "pino";

export interface Notifier {
  sendWhatsApp(to: string, message: string): Promise<void>;
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

const maskPhone = (p: string) => `******${p.slice(-4)}`;
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

/** Development notifier: logs what would be sent, with contact details masked. */
export function createLogNotifier(log: Logger): Notifier {
  return {
    async sendWhatsApp(to, message) {
      log.info({ to: maskPhone(to), message }, "whatsapp (not sent: log notifier)");
    },
    async sendEmail(to, subject) {
      log.info({ to: maskEmail(to), subject }, "email (not sent: log notifier)");
    },
  };
}
