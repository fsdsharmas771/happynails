// Idempotent: safe to run repeatedly; never overwrites existing records.
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongo";
import { loadEnv } from "../env";
import { createLogger } from "../logger";
import "../models/Admin";
import "../models/Booking";
import "../models/Order";
import "../models/Product";
import { seedOwner } from "../seed/admin";
import { seedBookingSetup } from "../seed/bookings";
import { seedProducts } from "../seed/seedProducts";

const env = loadEnv();
const logger = createLogger(env);

await connectMongo(env.MONGO_URL, logger, 3);
// Build indexes (including the double-booking guard) before inserting anything.
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
logger.info(await seedProducts(), "seeded products");
logger.info(await seedBookingSetup(), "seeded services, add-ons and technician");
logger.info(await seedOwner(env.ADMIN_OWNER_EMAIL, env.ADMIN_OWNER_PASSWORD));
await disconnectMongo();
