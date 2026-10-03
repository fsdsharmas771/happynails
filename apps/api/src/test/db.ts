import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";

/**
 * Gives a test file its own throwaway database on the dev Mongo replica set
 * (an in-memory mongod does not run on Alpine), dropped when the file finishes.
 */
export function useTestDb(): void {
  beforeAll(async () => {
    const base = process.env.MONGO_URL;
    if (!base) throw new Error("MONGO_URL is not set; run tests inside the api container");
    const url = new URL(base);
    url.pathname = `/hn_test_${randomBytes(4).toString("hex")}`;
    await mongoose.connect(url.toString(), { serverSelectionTimeoutMS: 5000 });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });

  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
