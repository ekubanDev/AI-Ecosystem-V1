import { getConfig } from "../config/env.js";
import { User } from "../models/index.js";
import { REFRESH_COOKIE, refreshCookieOptions } from "../services/authService.js";
import { AppError } from "../utils/errors.js";
import { ok } from "../utils/http.js";

const GENERIC = "If the account exists, an email has been sent.";
const svc = (req) => req.app.locals.container.authService;

const sendSession = (res, session, status = 200) => {
  res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
  return ok(res, { accessToken: session.accessToken, user: session.user }, { status });
};

export const publicConfig = async (_req, res) => ok(res, { registrationEnabled: getConfig().REGISTRATION_ENABLED });
export const register = async (req, res) => ok(res, { user: await svc(req).register(req.valid.body, req) }, { status: 201 });
export const login = async (req, res) => sendSession(res, await svc(req).login(req.valid.body, req));

export const refresh = async (req, res) => {
  try {
    return sendSession(res, await svc(req).refresh(req.cookies?.[REFRESH_COOKIE]));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    throw err;
  }
};

export const logout = async (req, res) => {
  await svc(req).logout(req.cookies?.[REFRESH_COOKIE], req);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  return ok(res, { loggedOut: true });
};

export const me = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new AppError("TOKEN_INVALID", "Invalid access token.");
  return ok(res, { user });
};

export const verifyEmail = async (req, res) => {
  const token = req.valid.query?.token ?? req.valid.body?.token;
  await svc(req).verifyEmail(token, req);
  return ok(res, { verified: true });
};

export const resendVerification = async (req, res) => {
  await svc(req).resendVerification(req.valid.body.email);
  return ok(res, { message: GENERIC });
};

export const forgotPassword = async (req, res) => {
  await svc(req).forgotPassword(req.valid.body.email);
  return ok(res, { message: GENERIC });
};

export const resetPassword = async (req, res) => {
  await svc(req).resetPassword(req.valid.body, req);
  return ok(res, { reset: true });
};
