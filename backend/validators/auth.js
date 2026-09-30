import { z } from "zod";
import { email, nonEmpty } from "./common.js";

// bcrypt only uses the first 72 bytes, so cap there rather than silently truncating.
const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .refine((v) => Buffer.byteLength(v) <= 72, "Password must be at most 72 bytes");

export const register = z.object({ name: nonEmpty(120), email, password });
export const login = z.object({ email, password: z.string().min(1).max(200) });
export const emailOnly = z.object({ email });
export const tokenQuery = z.object({ token: z.string().min(16).max(256) });
export const tokenBody = z.object({ token: z.string().min(16).max(256) });
export const resetPassword = z.object({ token: z.string().min(16).max(256), password });
