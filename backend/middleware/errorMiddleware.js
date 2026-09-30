import { AppError } from "../utils/errors.js";
import { zodDetails } from "./validate.js";
import { logger } from "../utils/logger.js";
import { ZodError } from "zod";

export const notFoundHandler = (req, _res, next) =>
  next(new AppError("RESOURCE_NOT_FOUND", `Route ${req.method} ${req.path} not found.`));

const send = (res, req, status, code, message, details = []) =>
  res.status(status).json({ success: false, error: { code, message, details }, meta: { requestId: req.id } });

export const errorHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error("request failed", { requestId: req.id, err });
    return send(res, req, err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) return send(res, req, 422, "VALIDATION_ERROR", "One or more fields are invalid.", zodDetails(err));
  if (err?.name === "ValidationError" && err.errors) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return send(res, req, 422, "VALIDATION_ERROR", "One or more fields are invalid.", details);
  }
  if (err?.name === "CastError") return send(res, req, 422, "VALIDATION_ERROR", `Invalid value for ${err.path}.`);
  if (err?.code === 11000) return send(res, req, 409, "RESOURCE_CONFLICT", "A resource with the same unique value already exists.");
  if (err?.type === "entity.parse.failed") return send(res, req, 400, "VALIDATION_ERROR", "Malformed JSON body.");
  if (err?.type === "entity.too.large") return send(res, req, 413, "VALIDATION_ERROR", "Request body too large.");
  if (err?.message === "Not allowed by CORS") return send(res, req, 403, "FORBIDDEN", "Origin not allowed.");

  logger.error("unhandled error", { requestId: req.id, err });
  return send(res, req, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
};
