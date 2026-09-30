import { AuditEvent, User } from "../models/index.js";
import { buildSort } from "../utils/pagination.js";

/** Lists audit events (newest first by default) with the actor's name attached for USER events. */
export async function listAuditEvents(q) {
  const filter = {};
  for (const k of ["action", "resourceType", "resourceId", "actorId", "actorType"]) if (q[k]) filter[k] = q[k];
  if (q.from || q.to) filter.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };

  const [events, total] = await Promise.all([
    AuditEvent.find(filter).sort(buildSort(q.sortBy, q.order, ["createdAt"])).skip((q.page - 1) * q.limit).limit(q.limit),
    AuditEvent.countDocuments(filter),
  ]);

  const userIds = [...new Set(events.filter((e) => e.actorType === "USER" && e.actorId).map((e) => String(e.actorId)))];
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name email role") : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const items = events.map((e) => {
    const u = e.actorId ? byId.get(String(e.actorId)) : null;
    return { ...e.toJSON(), actor: { id: e.actorId ? String(e.actorId) : null, type: e.actorType, name: u?.name ?? null, email: u?.email ?? null, role: u?.role ?? null } };
  });
  return { items, total };
}
