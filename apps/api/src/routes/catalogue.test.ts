import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { productDetailResponseSchema, productListResponseSchema } from "@happynails/shared";
import { createApp } from "../app";
import { Product } from "../models/Product";
import { SEED_PRODUCTS } from "../seed/products";
import { seedProducts } from "../seed/seedProducts";
import { useTestDb } from "../test/db";

useTestDb();

const app = createApp({
  logger: pino({ level: "silent" }),
  allowedOrigins: [],
  checks: { mongo: async () => true, redis: async () => true },
});

describe("GET /api/products", () => {
  it("lists active sets in sort order with sizing options and no stock counts", async () => {
    await seedProducts();
    await Product.updateOne({ slug: "milk-bath" }, { active: false });
    await Product.updateOne({ slug: "noir-gloss" }, { stock: 0 });

    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    const body = productListResponseSchema.parse(res.body);

    expect(body.products.map((p) => p.slug)).toEqual(
      SEED_PRODUCTS.filter((p) => p.slug !== "milk-bath").map((p) => p.slug),
    );
    expect(body.products.find((p) => p.slug === "noir-gloss")?.inStock).toBe(false);
    expect(body.products.find((p) => p.slug === "blush-hour")).toMatchObject({
      inStock: true,
      color2: "#F7E4DF",
      pricePaise: 119900,
    });
    expect(res.text).not.toContain('"stock"');
    expect(body.sizingOptions.map((o) => o.key)).toEqual(["standard", "custom"]);
  });
});

describe("GET /api/products/:slug", () => {
  it("returns one active set", async () => {
    await seedProducts();
    const res = await request(app).get("/api/products/rose-chrome");
    expect(res.status).toBe(200);
    expect(productDetailResponseSchema.parse(res.body).product).toMatchObject({
      name: "Rose Chrome",
      finish: "chrome",
    });
  });

  it.each(["no-such-set", "Rose%20Chrome", "%24where"])("404s for %s", async (slug) => {
    await seedProducts();
    const res = await request(app).get(`/api/products/${slug}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("hides inactive sets", async () => {
    await seedProducts();
    await Product.updateOne({ slug: "pearl-veil" }, { active: false });
    expect((await request(app).get("/api/products/pearl-veil")).status).toBe(404);
  });
});

describe("seedProducts", () => {
  it("is idempotent and keeps the owner's edits", async () => {
    expect(await seedProducts()).toEqual({ inserted: 10, skipped: 0 });
    await Product.updateOne({ slug: "rose-chrome" }, { pricePaise: 155000 });
    expect(await seedProducts()).toEqual({ inserted: 0, skipped: 10 });
    expect((await Product.findOne({ slug: "rose-chrome" }).lean())?.pricePaise).toBe(155000);
    expect(await Product.countDocuments()).toBe(10);
  });
});

describe("POST /api/shipping/eta", () => {
  it("estimates by pincode", async () => {
    const res = await request(app).post("/api/shipping/eta").send({ pincode: "110017" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ standard: "1 to 2 days", express: "Next day", standardDays: [1, 2] });
  });

  it.each([{ pincode: "1100" }, { pincode: 110017 }, {}])(
    "rejects %j with a validation error",
    async (body) => {
      const res = await request(app).post("/api/shipping/eta").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    },
  );
});
