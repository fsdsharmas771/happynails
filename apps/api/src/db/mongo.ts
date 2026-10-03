import mongoose from "mongoose";
import type { Logger } from "pino";

/** Connects with retries; mongoose only reconnects on its own after a first successful connect. */
export async function connectMongo(url: string, log: Logger, attempts = 20): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(url, { serverSelectionTimeoutMS: 5000 });
      log.info("mongo connected");
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      log.warn({ err, attempt }, "mongo connect failed, retrying");
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}

export async function pingMongo(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !db) return false;
  const res = await db.admin().ping();
  return res.ok === 1;
}

export function disconnectMongo(): Promise<void> {
  return mongoose.disconnect();
}
