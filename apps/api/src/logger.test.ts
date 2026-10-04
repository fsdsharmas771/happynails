import { Writable } from "node:stream";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { redactTokens } from "./logger";
import { fakeJobs } from "./test/app";
import { Redis } from "ioredis";

describe("request logs", () => {
  it("never contain customer access tokens", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino({ level: "info" }, sink);
    const app = createApp({
      logger,
      allowedOrigins: [],
      checks: { mongo: async () => true, redis: async () => true },
      orders: { gateway: null, jobs: fakeJobs(), log: logger },
      bookings: { redis: new Redis({ lazyConnect: true }), gateway: null, jobs: fakeJobs(), log: logger },
      admin: {
        auth: { jwtSecret: "x".repeat(40), secureCookies: false },
        uploads: { save: async () => ({ url: "" }) },
        uploadDir: "/tmp",
      },
      shipping: { provider: null },
      rateLimits: false,
    });
    await request(app)
      .get("/api/nowhere?number=HN260001&token=SECRETTOKEN123")
      .set("Referer", "https://shop.example/order/HN260001?token=SECRETTOKEN123&paid=1");
    const log = lines.join("");
    expect(log).toContain("HN260001");
    expect(log).not.toContain("SECRETTOKEN123");
  });

  it("redacts tokens anywhere in a query string", () => {
    expect(redactTokens("/x?token=abc&paid=1")).toBe("/x?token=[redacted]&paid=1");
    expect(redactTokens("/x?a=1&TOKEN=abc#top")).toBe("/x?a=1&TOKEN=[redacted]#top");
    expect(redactTokens("/x?tokens=keep")).toBe("/x?tokens=keep");
  });
});
