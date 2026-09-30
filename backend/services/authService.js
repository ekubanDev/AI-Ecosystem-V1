import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getConfig } from "../config/env.js";
import { User } from "../models/index.js";
import { AppError, conflict } from "../utils/errors.js";
import { randomToken, sha256 } from "../utils/text.js";
import { audit } from "./auditService.js";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
// Compared against when the email is unknown so response time doesn't reveal whether an account exists.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password", getConfig().BCRYPT_ROUNDS));

export const REFRESH_COOKIE = "abf_refresh";

const signAccess = (user) =>
  jwt.sign({ type: "access" }, getConfig().JWT_ACCESS_SECRET, {
    algorithm: "HS256", subject: String(user._id), expiresIn: getConfig().JWT_ACCESS_EXPIRES_IN,
  });

const signRefresh = (user, version) =>
  jwt.sign({ type: "refresh", tv: version }, getConfig().JWT_REFRESH_SECRET, {
    algorithm: "HS256", subject: String(user._id), expiresIn: getConfig().JWT_REFRESH_EXPIRES_IN,
  });

export const refreshCookieOptions = () => {
  const c = getConfig();
  const days = /^(\d+)d$/.exec(c.JWT_REFRESH_EXPIRES_IN);
  return {
    httpOnly: true,
    secure: c.isProd || c.COOKIE_SAMESITE === "none",
    sameSite: c.COOKIE_SAMESITE,
    path: "/api/auth",
    ...(days ? { maxAge: Number(days[1]) * 86400000 } : {}),
  };
};

const issueTokens = (user, version) => ({ accessToken: signAccess(user), refreshToken: signRefresh(user, version) });

export function createAuthService({ emailService }) {
  const startEmailVerification = async (user) => {
    const token = randomToken();
    await User.updateOne(
      { _id: user._id },
      { $set: { emailVerificationTokenHash: sha256(token), emailVerificationExpiresAt: new Date(Date.now() + VERIFY_TTL_MS) } }
    );
    await emailService.sendVerification(user, token);
  };

  return {
    async register({ name, email, password }, req) {
      if (await User.exists({ email })) throw conflict("An account with this email already exists.");
      const passwordHash = await bcrypt.hash(password, getConfig().BCRYPT_ROUNDS);
      // Bootstrap: the very first account becomes OWNER; everyone else starts as VIEWER until an OWNER/ADMIN promotes them.
      const role = (await User.estimatedDocumentCount()) === 0 ? "OWNER" : "VIEWER";
      let user;
      try {
        user = await User.create({ name, email, passwordHash, role });
      } catch (err) {
        if (err.code === 11000) throw conflict("An account with this email already exists.");
        throw err;
      }
      await startEmailVerification(user);
      await audit({ actor: { type: "USER", id: user._id }, action: "USER_REGISTERED", resourceType: "User", resourceId: user._id, metadata: { role }, req });
      return user;
    },

    async verifyEmail(token, req) {
      const user = await User.findOneAndUpdate(
        { emailVerificationTokenHash: sha256(token), emailVerificationExpiresAt: { $gt: new Date() } },
        { $set: { isEmailVerified: true }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } },
        { returnDocument: "after" }
      );
      if (!user) throw new AppError("TOKEN_INVALID", "Verification link is invalid or has expired.");
      await audit({ actor: { type: "USER", id: user._id }, action: "EMAIL_VERIFIED", resourceType: "User", resourceId: user._id, req });
      return user;
    },

    async resendVerification(email) {
      const user = await User.findOne({ email });
      if (user && !user.isEmailVerified && user.isActive) await startEmailVerification(user);
    },

    async login({ email, password }, req) {
      const user = await User.findOne({ email });
      const valid = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
      if (!user || !valid || !user.isActive) throw new AppError("INVALID_CREDENTIALS", "Invalid email or password.");
      if (!user.isEmailVerified) throw new AppError("EMAIL_NOT_VERIFIED", "Please verify your email before logging in.");
      user.lastLoginAt = new Date();
      await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });
      await audit({ actor: { type: "USER", id: user._id }, action: "USER_LOGIN", resourceType: "User", resourceId: user._id, req });
      return { user, ...issueTokens(user, user.refreshTokenVersion) };
    },

    /** Rotates the refresh token: the old one stops working atomically, so a replayed/stolen token fails. */
    async refresh(refreshToken) {
      if (!refreshToken) throw new AppError("AUTH_REQUIRED", "Refresh token missing.");
      let payload;
      try {
        payload = jwt.verify(refreshToken, getConfig().JWT_REFRESH_SECRET, { algorithms: ["HS256"] });
      } catch (err) {
        throw new AppError(err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "TOKEN_INVALID", "Invalid or expired refresh token.");
      }
      if (payload.type !== "refresh") throw new AppError("TOKEN_INVALID", "Invalid refresh token.");
      const user = await User.findOneAndUpdate(
        { _id: payload.sub, refreshTokenVersion: payload.tv, isActive: true },
        { $inc: { refreshTokenVersion: 1 } },
        { returnDocument: "after" }
      );
      if (!user) throw new AppError("TOKEN_INVALID", "Refresh token is no longer valid.");
      return { user, ...issueTokens(user, user.refreshTokenVersion) };
    },

    /** Invalidates all refresh tokens for the user identified by the (possibly expired) cookie. */
    async logout(refreshToken, req) {
      if (!refreshToken) return;
      let payload;
      try {
        payload = jwt.verify(refreshToken, getConfig().JWT_REFRESH_SECRET, { algorithms: ["HS256"], ignoreExpiration: true });
      } catch {
        return;
      }
      if (payload.type !== "refresh") return;
      const user = await User.findOneAndUpdate({ _id: payload.sub, refreshTokenVersion: payload.tv }, { $inc: { refreshTokenVersion: 1 } });
      if (user) await audit({ actor: { type: "USER", id: user._id }, action: "USER_LOGOUT", resourceType: "User", resourceId: user._id, req });
    },

    async forgotPassword(email) {
      const user = await User.findOne({ email });
      if (!user || !user.isActive) return;
      const token = randomToken();
      await User.updateOne(
        { _id: user._id },
        { $set: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MS) } }
      );
      await emailService.sendPasswordReset(user, token);
    },

    /** Single-use: the token is consumed in the same atomic update that sets the new password. */
    async resetPassword({ token, password }, req) {
      const passwordHash = await bcrypt.hash(password, getConfig().BCRYPT_ROUNDS);
      const user = await User.findOneAndUpdate(
        { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: { $gt: new Date() } },
        { $set: { passwordHash }, $inc: { refreshTokenVersion: 1 }, $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } },
        { returnDocument: "after" }
      );
      if (!user) throw new AppError("TOKEN_INVALID", "Reset link is invalid or has expired.");
      await audit({ actor: { type: "USER", id: user._id }, action: "PASSWORD_RESET_COMPLETED", resourceType: "User", resourceId: user._id, req });
      return user;
    },
  };
}
