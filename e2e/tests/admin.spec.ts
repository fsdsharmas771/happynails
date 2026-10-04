import { expect, test } from "@playwright/test";
import { adminCredentials } from "./helpers";

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://admin:5174";

test("the owner signs in, sees today's work and signs out", async ({ page }) => {
  test.skip(!adminCredentials, "Set ADMIN_OWNER_EMAIL and ADMIN_OWNER_PASSWORD (or E2E_ADMIN_*)");
  await page.goto(ADMIN_URL);
  await page.getByLabel("Email").fill(adminCredentials!.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password do not match")).toBeVisible();

  await page.getByLabel("Password").fill(adminCredentials!.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".stat").first()).toBeVisible();
  for (const name of ["Orders", "Bookings", "Availability", "GST"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
