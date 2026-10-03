import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../errors";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

function clientStatus(err: unknown): number | null {
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
    return err.status >= 400 && err.status < 500 ? err.status : null;
  }
  return null;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.issues } });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const status = clientStatus(err);
  if (status) {
    const code = status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST";
    res.status(status).json({ error: { code, message: "Request could not be processed" } });
    return;
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
