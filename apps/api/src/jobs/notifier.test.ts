import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { buildMessage, toWhatsAppNumber, WHATSAPP_TEMPLATES } from "../config/whatsapp";
import { createWhatsAppCloudNotifier } from "./notifier";

const log = pino({ level: "silent" });
const cfg = { accessToken: "secret-token", phoneNumberId: "123456789", apiVersion: "v23.0", language: "en" };

describe("WhatsApp templates", () => {
  it("fills parameters in order and renders the customer's text", () => {
    const m = buildMessage("order_placed", ["Riya", "HN260001", "₹1,648"]);
    expect(m.template).toBe("hn_order_placed");
    expect(m.params).toEqual(["Riya", "HN260001", "₹1,648"]);
    expect(m.text).toBe(
      "Hi Riya, thank you for your Happy Nails order HN260001 of ₹1,648. We will message you when it ships.",
    );
  });

  it("cleans parameters Meta would reject", () => {
    expect(buildMessage("booking_reminder", ["A\nB", "x     y"]).params).toEqual(["A B", "x   y"]);
    expect(buildMessage("booking_reminder", ["", "x"]).params[0]).toBe("-");
  });

  it("every template's placeholders are numbered 1..n without gaps", () => {
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      const nums = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it("formats Indian numbers for WhatsApp", () => {
    expect(toWhatsAppNumber("9876543210")).toBe("919876543210");
    expect(toWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
  });
});

describe("WhatsApp Cloud API notifier", () => {
  it("posts a template message to the Graph API", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await createWhatsAppCloudNotifier(cfg, log, fake).sendWhatsApp(
      "919876543210",
      buildMessage("booking_reminder", ["Sana", "Sat 4 Oct, 10:00 am"]),
    );
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/123456789/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919876543210",
      type: "template",
      template: {
        name: "hn_visit_reminder",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Sana" },
              { type: "text", text: "Sat 4 Oct, 10:00 am" },
            ],
          },
        ],
      },
    });
  });

  it("throws on an API error (so the job retries) without leaking the token", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: { message: "Template name does not exist", code: 132001 } }), {
        status: 404,
      })) as unknown as typeof fetch;
    const err = await createWhatsAppCloudNotifier(cfg, log, fake)
      .sendWhatsApp("919876543210", buildMessage("booking_reminder", ["A", "B"]))
      .catch((e: Error) => e);
    expect(String(err)).toContain("132001");
    expect(String(err)).not.toContain("secret-token");
  });
});
