import jwt from "jsonwebtoken";
import { getConfig } from "../config/env.js";
import { can } from "../config/permissions.js";
import { User } from "../models/index.js";
import { AppError, forbidden } from "../utils/errors.js";

/** Verifies the Bearer access token and loads the user (role/active state are read fresh on every request). */
export const protect = async (req, _res, next) => {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) throw new AppError("AUTH_REQUIRED", "Authentication required.");

  let payload;
  try {
    payload = jwt.verify(token, getConfig().JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new AppError("TOKEN_EXPIRED", "Access token expired.");
    throw new AppError("TOKEN_INVALID", "Invalid access token.");
  }
  if (payload.type !== "access") throw new AppError("TOKEN_INVALID", "Invalid access token.");

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw new AppError("TOKEN_INVALID", "Invalid access token.");

  req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified };
  next();
};

export const authorizeRoles =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) throw forbidden();
    next();
  };

export const requireCapability = (capability) => (req, _res, next) => {
  if (!can(req.user?.role, capability)) throw forbidden();
  next();
};
