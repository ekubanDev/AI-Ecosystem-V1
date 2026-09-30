import mongoose from "mongoose";
import { AuditEvent } from "../models/index.js";
import { logger } from "../utils/logger.js";

const REDACT = new Set([
  "passwordHash", "emailVerificationTokenHash", "passwordResetTokenHash", "refreshTokenVersion", "password", "token",
]);

const clean = (v) => {
  if (v == null) return v;
  if (typeof v.toObject === "function") v = v.toObject();
  return JSON.parse(
    JSON.stringify(v, (k, val) => (REDACT.has(k) ? undefined : val))
  );
};

const oid = (id) => (id && mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(String(id)) : undefined);

export const actorFromReq = (req) => (req?.user ? { type: "USER", id: req.user.id } : { type: "SYSTEM" });
export const AGENT_ACTOR = (agentType) => ({ type: "AGENT", metadata: { agentType } });

/**
 * Records an append-only audit event. Failures are logged loudly but never fail the business operation
 * (standalone MongoDB has no cross-collection transactions).
 */
export async function audit({ actor, action, resourceType, resourceId, before, after, metadata, req }) {
  try {
    return await AuditEvent.create({
      actorId: oid(actor?.id),
      actorType: actor?.type ?? "SYSTEM",
      action,
      resourceType,
      resourceId: oid(resourceId),
      before: clean(before),
      after: clean(after),
      metadata: clean({ ...(actor?.metadata ?? {}), ...(metadata ?? {}) }),
      ipAddress: req?.ip,
      userAgent: req?.get?.("user-agent")?.slice(0, 300),
      requestId: req?.id,
    });
  } catch (err) {
    logger.error("audit write failed", { action, resourceType, resourceId: String(resourceId), err });
  }
}
