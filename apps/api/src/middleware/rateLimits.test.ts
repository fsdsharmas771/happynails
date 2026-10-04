import request from "supertest";
import { describe, expect, it } from "vitest";
import { testApp, TEST_COURIER_TOKEN } from "../test/app";
import { useTestDb } from "../test/db";

useTestDb();

const limits = { general: 8, checkout: 2, holds: 2, lookups: 3 };

describe("public rate limits", () => {
  it("caps placing orders per address, with a stable error code", async () => {
    const app = testApp({ rateLimits: limits });
    // Invalid bodies still count: the limit runs before validation.
    expect((await request(app).post("/api/orders").send({})).status).toBe(400);
    expect((await request(app).post("/api/orders").send({})).status).toBe(400);
    const third = await request(app).post("/api/orders").send({});
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    expect(third.headers["retry-after"]).toBeDefined();
  });

  it("counts each client address separately behind the proxy", async () => {
    const app = testApp({ rateLimits: limits });
    const from = (ip: string) =>
      request(app).post("/api/pincode/check").set("X-Forwarded-For", ip).send({ pincode: "110016" });
    for (let i = 0; i < 3; i++) expect((await from("203.0.113.1")).status).toBe(200);
    expect((await from("203.0.113.1")).status).toBe(429);
    expect((await from("203.0.113.2")).status).toBe(200);
  });

  it("never limits webhooks or the health check", async () => {
    const app = testApp({ rateLimits: limits });
    for (let i = 0; i < limits.general + 2; i++) {
      expect((await request(app).get("/api/health")).status).toBe(200);
      const res = await request(app)
        .post("/api/webhooks/courier-tracking")
        .set("x-api-key", TEST_COURIER_TOKEN)
        .send({ awb: "NONE", current_status: "IN TRANSIT" });
      expect(res.status).not.toBe(429);
    }
  });

  it("applies an overall cap to everything else", async () => {
    const app = testApp({ rateLimits: limits });
    const statuses: number[] = [];
    for (let i = 0; i < limits.general + 1; i++)
      statuses.push((await request(app).get("/api/nothing")).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, -1).every((s) => s === 404)).toBe(true);
  });
});
