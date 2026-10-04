import { expect, test, type Page } from "@playwright/test";
import { cancelBooking, payWithTestCard, settle } from "./helpers";

async function chooseVisit(page: Page, dayIndex: number) {
  await page.goto("/");
  await settle(page);
  const book = page.locator("#book");
  await book.scrollIntoViewIfNeeded();
  await book.getByLabel("Pincode").fill("201301");
  await book.getByRole("button", { name: "Choose a service" }).click();
  await expect(book.getByText("What would you like?")).toBeVisible();
  await book.getByRole("button", { name: "Pick a day" }).click();
  await page.waitForSelector(".days[aria-busy=false] .day:not([disabled])");
  await page.locator(".day:not([disabled]):not(.blank)").nth(dayIndex).click();
  await page.locator(".slot:not([disabled])").first().click();
  await expect(page.locator(".slot[aria-pressed=true]")).toHaveCount(1);
  await book.getByRole("button", { name: "Your details" }).click();
  await book.getByLabel("Name").fill("Sana Mehta");
  await book.getByLabel("Mobile number").fill("9000090000");
  await book.getByLabel("Address for the visit").fill("Tower 3, Sector 18, Noida");
  return book;
}

test("book a home visit in Noida and pay after the visit", async ({ page }) => {
  let ref: string | undefined;
  try {
    const book = await chooseVisit(page, 2);
    await book.getByText("Pay after your visit", { exact: true }).click();
    await book.getByRole("button", { name: "Confirm booking" }).click();
    await expect(book.getByText("Booking confirmed")).toBeVisible();
    await expect(book).toContainText("Pay after your visit by UPI or cash.");
    ref = (await book.locator(".ref").textContent())?.trim();
    expect(ref).toMatch(/^HN-V\d+$/);
  } finally {
    if (ref) await cancelBooking(ref);
  }
});

test("book a home visit and pay online with Razorpay", async ({ page }) => {
  let ref: string | undefined;
  try {
    const book = await chooseVisit(page, 3);
    const payNow = book.getByRole("button", { name: /Confirm and pay ₹/ });
    test.skip(!(await payNow.isVisible()), "Razorpay test keys are not configured");
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/bookings") && r.request().method() === "POST",
    );
    await payNow.click();
    ref = ((await (await created).json()) as { number: string }).number;
    await payWithTestCard(page);
    await expect(book.getByText("See you soon, Sana.")).toBeVisible({ timeout: 90_000 });
  } finally {
    if (ref) await cancelBooking(ref);
  }
});
