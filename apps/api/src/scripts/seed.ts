// Seed data arrives with the catalogue (phase 3) and the admin owner (phase 6).
// Kept now so `pnpm seed` is wired end to end.
import { connectMongo, disconnectMongo } from "../db/mongo";
import { loadEnv } from "../env";
import { createLogger } from "../logger";

const env = loadEnv();
const logger = createLogger(env);

await connectMongo(env.MONGO_URL, logger, 3);
logger.info("nothing to seed yet");
await disconnectMongo();
