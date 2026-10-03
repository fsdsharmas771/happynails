import { Redis } from "ioredis";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "@happynails/shared";
import { createApp } from "./app";
import { fakeJobs } from "./test/app";

const logger = pino({ level: "silent" });
const up = async () => true;
const down = async () => false;

function appWith(mongo = up, redis = up) {
  return createApp({
    logger,
    allowedOrigins: ["http://localhost:5173"],
    checks: { mongo, redis },
    orders: { gateway: null, jobs: fakeJobs(), log: logger },
    bookings: { redis: new Redis({ lazyConnect: true }), jobs: fakeJobs(), log: logger },
  });
}

describe("GET /api/health", () => {
  it("returns 200 when mongo and redis are up", async () => {
    const res = await request(appWith()).get("/api/health");
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body).toMatchObject({ status: "ok", checks: { mongo: "ok", redis: "ok" } });
  });

  it("returns 503 and names the failing dependency", async () => {
    const res = await request(appWith(up, down)).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ mongo: "ok", redis: "down" });
  });

  it("treats a throwing check as down", async () => {
    const boom = async (): Promise<boolean> => {
      throw new Error("no connection");
    };
    const res = await request(appWith(boom, up)).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.mongo).toBe("down");
  });
});

describe("app plumbing", () => {
  it("returns a JSON 404 with a stable code", async () => {
    const res = await request(appWith()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("echoes a safe x-request-id and generates one otherwise", async () => {
    const echoed = await request(appWith()).get("/api/health").set("x-request-id", "abc-123");
    expect(echoed.headers["x-request-id"]).toBe("abc-123");
    const generated = await request(appWith()).get("/api/health").set("x-request-id", "bad id!");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("only allows CORS from configured origins", async () => {
    const ok = await request(appWith()).get("/api/health").set("Origin", "http://localhost:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await request(appWith()).get("/api/health").set("Origin", "https://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(appWith())
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});
