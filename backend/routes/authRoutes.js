import { Router } from "express";
import * as c from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";
import { requireAllowedOrigin } from "../middleware/sameOrigin.js";
import { validate } from "../middleware/validate.js";
import * as v from "../validators/auth.js";

export default function authRoutes(authLimiter) {
  const r = Router();
  r.use(authLimiter);
  r.post("/register", validate({ body: v.register }), c.register);
  r.post("/login", validate({ body: v.login }), c.login);
  r.post("/logout", requireAllowedOrigin, c.logout);
  r.post("/refresh", requireAllowedOrigin, c.refresh);
  r.get("/me", protect, c.me);
  r.get("/verify-email", validate({ query: v.tokenQuery }), c.verifyEmail);
  r.post("/verify-email", validate({ body: v.tokenBody }), c.verifyEmail);
  r.post("/resend-verification", validate({ body: v.emailOnly }), c.resendVerification);
  r.post("/forgot-password", validate({ body: v.emailOnly }), c.forgotPassword);
  r.post("/reset-password", validate({ body: v.resetPassword }), c.resetPassword);
  return r;
}
