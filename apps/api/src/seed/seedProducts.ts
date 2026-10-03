import { Product } from "../models/Product";
import { SEED_PRODUCTS } from "./products";

/**
 * Inserts any seed set that does not exist yet, matched by slug.
 * Existing products are left untouched so the owner's edits (prices, stock, copy) survive a re-seed.
 */
export async function seedProducts(): Promise<{ inserted: number; skipped: number }> {
  const res = await Product.bulkWrite(
    SEED_PRODUCTS.map((p) => ({
      updateOne: { filter: { slug: p.slug }, update: { $setOnInsert: p }, upsert: true },
    })),
  );
  return { inserted: res.upsertedCount, skipped: SEED_PRODUCTS.length - res.upsertedCount };
}
