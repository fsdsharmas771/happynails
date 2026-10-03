import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { errorHandler, notFound } from "./middleware/error";
import { productsRouter, shippingRouter } from "./routes/catalogue";
import { healthRouter, type HealthCheck } from "./routes/health";

export interface AppDeps {
  logger: Logger;
  allowedOrigins: string[];
  checks: { mongo: HealthCheck; redis: HealthCheck };
}

const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

export function createApp({ logger, allowedOrigins, checks }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === "/api/health" },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: allowedOrigins, credentials: true }));

  // Routes that need the raw body (the Razorpay webhook) must be mounted above this line.
  app.use(express.json({ limit: "100kb" }));

  app.use("/api/health", healthRouter(checks));
  app.use("/api/products", productsRouter());
  app.use("/api/shipping", shippingRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
