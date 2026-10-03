import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { errorHandler, notFound } from "./middleware/error";
import { productsRouter, shippingRouter } from "./routes/catalogue";
import { healthRouter, type HealthCheck } from "./routes/health";
import { checkoutRouter, ordersRouter, paymentsRouter, webhooksRouter } from "./routes/orders";
import type { OrderDeps } from "./orders/service";
import type { BookingDeps } from "./bookings/engine";
import { availabilityRouter, bookingsRouter, pincodeRouter, servicesRouter } from "./routes/bookings";

export interface AppDeps {
  logger: Logger;
  allowedOrigins: string[];
  checks: { mongo: HealthCheck; redis: HealthCheck };
  orders: OrderDeps;
  bookings: BookingDeps;
}

const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

export function createApp({ logger, allowedOrigins, checks, orders, bookings }: AppDeps): Express {
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

  // Raw-body routes first: the Razorpay webhook signature covers the exact bytes received.
  app.use("/api/webhooks", webhooksRouter(orders));
  app.use(express.json({ limit: "100kb" }));

  app.use("/api/health", healthRouter(checks));
  app.use("/api/products", productsRouter());
  app.use("/api/shipping", shippingRouter());
  app.use("/api/checkout", checkoutRouter(orders));
  app.use("/api/orders", ordersRouter(orders));
  app.use("/api/payments", paymentsRouter(orders));
  app.use("/api/services", servicesRouter(bookings));
  app.use("/api/availability", availabilityRouter(bookings));
  app.use("/api/bookings", bookingsRouter(bookings));
  app.use("/api/pincode", pincodeRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
