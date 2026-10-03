import rateLimit from "express-rate-limit";
import { AppError } from "../utils/errors.js";

const make = (config, max, windowMs) =>
  config.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs,
        limit: max,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: (_req, _res, next) => next(new AppError("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.")),
      })
    : (_req, _res, next) => next();

export const globalLimiter = (config) => make(config, config.RATE_LIMIT_MAX, 15 * 60 * 1000);
export const authLimiter = (config) => make(config, config.AUTH_RATE_LIMIT_MAX, 15 * 60 * 1000);
export const leadLimiter = (config) => make(config, config.LEAD_RATE_LIMIT_MAX, 15 * 60 * 1000);
