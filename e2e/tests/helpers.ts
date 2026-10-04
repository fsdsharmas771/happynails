import { request, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://admin:5174";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_OWNER_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_OWNER_PASSWORD;

export const adminCredentials =
  ADMIN_EMAIL && ADMIN_PASSWORD ? { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } : null;

/** Keeps runs from piling up test data: cancels what a test created, through the admin API. */
export async function adminApi(): Promise<APIRequestContext | null> {
  if (!adminCredentials) return null;
  const api = await request.newContext({ baseURL: ADMIN_URL, extraHTTPHeaders: { "x-hn-admin": "1" } });
  const res = await api.post("/api/admin/auth/login", { data: adminCredentials });
  if (!res.ok()) throw new Error(`Admin sign-in failed: ${res.status()}`);
  return api;
}

export async function cancelOrder(number: string) {
  const api = await adminApi();
  if (!api) return;
  const list = (await (await api.get(`/api/admin/orders?q=${number}`)).json()) as {
    items: { _id: string; number: string; status: string }[];
  };
  const order = list.items.find((o) => o.number === number);
  if (order && ["pending_payment", "placed", "packed"].includes(order.status)) {
    await api.post(`/api/admin/orders/${order._id}/cancel`, { data: { note: "End-to-end test clean-up" } });
  }
  await api.dispose();
}

const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export async function cancelBooking(number: string) {
  const api = await adminApi();
  if (!api) return;
  const now = new Date();
  const to = new Date(now.getTime() + 70 * 86_400_000);
  const items = (await (
    await api.get(`/api/admin/bookings?from=${istDate(now)}&to=${istDate(to)}`)
  ).json()) as { _id: string; number: string; status: string }[];
  const b = items.find((x) => x.number === number);
  if (b && ["confirmed", "pending_payment"].includes(b.status)) {
    await api.post(`/api/admin/bookings/${b._id}/cancel`, { data: { note: "End-to-end test clean-up" } });
  }
  await api.dispose();
}

/**
 * Pays in Razorpay's test-mode Checkout with their domestic test Mastercard and the test OTP.
 * Razorpay changes this page from time to time; optional prompts are skipped when present.
 */
export async function payWithTestCard(page: Page) {
  await page.waitForSelector("iframe.razorpay-checkout-frame", { timeout: 60_000 });
  const frame: FrameLocator = page.frameLocator("iframe.razorpay-checkout-frame");
  // Razorpay may ask for contact details first; isVisible() does not wait, so wait explicitly.
  const appears = (l: ReturnType<FrameLocator["locator"]>, timeout: number) =>
    l.waitFor({ state: "visible", timeout }).then(
      () => true,
      () => false,
    );
  const contact = frame.locator('input[name="contact"]');
  if (await appears(contact, 15_000)) {
    if (!(await contact.inputValue())) await contact.pressSequentially("9000090000", { delay: 40 });
    await frame
      .getByRole("button", { name: "Continue" })
      .click({ timeout: 4000 })
      .catch(() => {});
  }
  await frame.getByText("Cards", { exact: true }).first().click({ timeout: 30_000 });
  for (const [name, value] of [
    ["card.number", "5267318187975449"],
    ["card.expiry", "1230"],
    ["card.cvv", "123"],
  ] as const) {
    const input = frame.locator(`input[name="${name}"]`);
    await input.click();
    await input.pressSequentially(value, { delay: 30 });
  }
  await frame.locator('button[name="button"]', { hasText: "Continue" }).click();
  const later = frame.getByRole("button", { name: /maybe later/i });
  if (await appears(later, 5000)) await later.click();
  const otp = frame.locator('input[name="otp"]');
  await otp.waitFor({ timeout: 60_000 });
  await otp.pressSequentially("1234", { delay: 40 });
  await frame.locator('button[type="submit"]', { hasText: "Continue" }).last().click();
}

/** Turns off smooth scrolling so clicks land where Playwright expects. */
export async function settle(page: Page) {
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
}
