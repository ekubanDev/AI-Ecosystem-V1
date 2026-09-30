import { User } from "../models/index.js";
import { AppError, forbidden, notFound } from "../utils/errors.js";
import { buildSort } from "../utils/pagination.js";
import { actorFromReq, audit } from "./auditService.js";

export async function listUsers(q) {
  const filter = q.role ? { role: q.role } : {};
  const sort = buildSort(q.sortBy, q.order, ["createdAt", "name", "email"]);
  const [items, total] = await Promise.all([
    User.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit),
    User.countDocuments(filter),
  ]);
  return { items, total };
}

/** Role / active changes. ADMINs cannot touch OWNERs or grant OWNER/ADMIN; nobody edits themselves; the last OWNER is protected. */
export async function updateUser(id, patch, req) {
  const target = await User.findById(id);
  if (!target) throw notFound("User");
  const actor = req.user;
  if (String(target._id) === actor.id) throw forbidden("You cannot change your own role or status.");
  if (actor.role !== "OWNER") {
    if (target.role === "OWNER" || target.role === "ADMIN") throw forbidden("Only an OWNER can modify OWNER or ADMIN accounts.");
    if (patch.role === "OWNER" || patch.role === "ADMIN") throw forbidden("Only an OWNER can grant OWNER or ADMIN.");
  }
  const demotesOwner = target.role === "OWNER" && ((patch.role && patch.role !== "OWNER") || patch.isActive === false);
  if (demotesOwner && (await User.countDocuments({ role: "OWNER", isActive: true, _id: { $ne: target._id } })) === 0) {
    throw new AppError("RESOURCE_CONFLICT", "Cannot remove the last active OWNER.");
  }

  const before = { role: target.role, isActive: target.isActive };
  const updated = await User.findByIdAndUpdate(id, { $set: patch, $inc: { refreshTokenVersion: 1 } }, { returnDocument: "after" }); // force re-login
  await audit({ actor: actorFromReq(req), action: "USER_ROLE_CHANGED", resourceType: "User", resourceId: updated._id, before, after: { role: updated.role, isActive: updated.isActive }, req });
  return updated;
}
