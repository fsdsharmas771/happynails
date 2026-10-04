import { defineConfig, devices } from "@playwright/test";

/**
 * Runs inside the Playwright container on the compose network (see the e2e service in
 * docker-compose.yml), against the development servers. The tests create real orders and
 * bookings and cancel them afterwards, so never point them at production.
 */
export default defineConfig({
  testDir: "./tests",
  // Razorpay's test checkout runs on their servers and can be slow.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  outputDir: "results",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://web:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
