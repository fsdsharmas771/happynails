// Issues GST invoices for anything paid before invoicing existed. Safe to run repeatedly.
import { connectMongo, disconnectMongo } from "../db/mongo";
import { loadEnv } from "../env";
import { ensureBookingInvoice, ensureOrderInvoice } from "../invoices/service";
import { createLogger } from "../logger";
import { Booking } from "../models/Booking";
import { Invoice } from "../models/Invoice";
import { Order } from "../models/Order";

const env = loadEnv();
const logger = createLogger(env);
await connectMongo(env.MONGO_URL, logger, 3);
await Invoice.init();

const orders = await Order.find({ "payment.status": { $in: ["captured", "refunded"] } })
  .sort({ "payment.paidAt": 1 })
  .select({ _id: 1 })
  .lean();
const bookings = await Booking.find({
  "payment.status": { $in: ["captured", "paid_after_visit", "refunded"] },
})
  .sort({ "payment.paidAt": 1 })
  .select({ _id: 1 })
  .lean();
for (const o of orders) await ensureOrderInvoice(String(o._id), logger);
for (const b of bookings) await ensureBookingInvoice(String(b._id), logger);
logger.info({ orders: orders.length, bookings: bookings.length }, "invoices checked");
await disconnectMongo();
