import { expect, test } from "@playwright/test";
import { cancelOrder, payWithTestCard, settle } from "./helpers";

test("browse the collection, fill the bag and pay with Razorpay", async ({ page }) => {
  let orderNumber: string | undefined;
  try {
    await page.goto("/");
    await settle(page);

    // Product drawer, then the bag.
    await page.locator(".card").first().click();
    await page.locator(".drawer.on .addrow .btn").click();
    await expect(page.locator(".bagbtn b")).toHaveText("1");
    await page.locator(".bagbtn").click();
    await expect(page.locator(".drawer.on .line")).toHaveCount(1);
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");

    // Details are validated before moving on.
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await expect(page.locator(".field.bad")).toHaveCount(7);
    await page.getByLabel("Full name").fill("Riya Sharma");
    await page.getByLabel("Mobile number").fill("9876543210");
    await page.getByLabel("Email for the receipt").fill("riya@example.com");
    await page.getByLabel("Address").fill("12 Park Street, Hauz Khas");
    await page.getByLabel("Pincode").fill("110016");
    await page.getByLabel("City").fill("New Delhi");
    await page.getByLabel("State").selectOption("Delhi");
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await page.getByRole("button", { name: "Continue to payment" }).click();

    const pay = page.getByRole("button", { name: /^Pay ₹/ });
    test.skip(
      await page.getByText("Online payment is not available right now").isVisible(),
      "Razorpay test keys are not configured",
    );
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/orders") && r.request().method() === "POST",
    );
    await pay.click();
    const body = (await (await created).json()) as { orderNumber: string; totalPaise: number };
    orderNumber = body.orderNumber;
    expect(orderNumber).toMatch(/^HN\d+$/);

    await payWithTestCard(page);

    // The checkout signature is verified by the API; the webhook then marks the order placed.
    await page.waitForURL(/\/order\/HN\d+\?.*paid=1/, { timeout: 90_000 });
    await expect(page.locator("#oH")).toContainText(/Payment received\.|Thank you, Riya\./);
    await expect(page.locator(".bagbtn b")).toHaveText("0");
  } finally {
    if (orderNumber) await cancelOrder(orderNumber);
  }
});
