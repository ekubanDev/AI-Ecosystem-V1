import { getConfig } from "../config/env.js";
import { forbidden } from "../utils/errors.js";

/** CSRF defense-in-depth for cookie-authenticated endpoints: if an Origin header is sent it must be an allowed client origin. */
export const requireAllowedOrigin = (req, _res, next) => {
  const origin = req.get("origin");
  if (origin && !getConfig().clientOrigins.includes(origin)) throw forbidden("Origin not allowed.");
  next();
};
