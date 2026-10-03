// Idempotent: safe to run repeatedly. The admin owner joins in phase 6.
import { connectMongo, disconnectMongo } from "../db/mongo";
import { loadEnv } from "../env";
import { createLogger } from "../logger";
import { Product } from "../models/Product";
import { seedProducts } from "../seed/seedProducts";

const env = loadEnv();
const logger = createLogger(env);

await connectMongo(env.MONGO_URL, logger, 3);
await Product.init();
const products = await seedProducts();
logger.info(products, "seeded products");
await disconnectMongo();
