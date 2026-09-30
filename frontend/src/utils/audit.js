import { humanize } from "./format.js";

const keys = (o) => (o && typeof o === "object" ? Object.keys(o) : []);

/** One-line, human-readable summary of what an audit event changed (details stay in the JSON view). */
export function describeAuditEvent(e) {
  const before = e.before ?? {};
  const after = e.after ?? {};
  const meta = e.metadata ?? {};

  if (e.action === "OPPORTUNITY_STATUS_CHANGED" || (before.status && after.status)) return `${humanize(before.status)} → ${humanize(after.status)}`;
  if (e.action === "USER_ROLE_CHANGED") {
    const parts = [];
    if (before.role !== after.role) parts.push(`role ${before.role ?? "—"} → ${after.role ?? "—"}`);
    if (before.isActive !== after.isActive && after.isActive !== undefined) parts.push(after.isActive ? "reactivated" : "deactivated");
    return parts.join(", ") || (meta.role ? `role ${meta.role}` : "");
  }
  if (e.action === "OPPORTUNITY_UPDATED") return keys(after).length ? `changed: ${keys(after).join(", ")}` : "";
  if (e.action === "OPPORTUNITY_REJECTED") return meta.reason ?? "";
  if (e.action === "OPPORTUNITY_APPROVED") return meta.note ?? "";
  if (e.action === "DISCOVERY_STARTED") return meta.request?.market ? `market: ${meta.request.market}` : "";
  if (e.action === "DISCOVERY_COMPLETED") return meta.status ? `${humanize(meta.status)}${meta.stats ? ` — ${meta.stats.opportunitiesCreated ?? 0} created` : ""}` : "";
  if (e.action.startsWith("AGENT_")) {
    const bits = [meta.agentType && humanize(meta.agentType), meta.error && `error: ${meta.error}`, meta.attempt && `attempt ${meta.attempt}`].filter(Boolean);
    return bits.join(" · ");
  }
  if (e.action.startsWith("EXPERIMENT_")) return after.name ?? (before.status && after.status ? `${humanize(before.status)} → ${humanize(after.status)}` : "");
  if (e.action === "OPPORTUNITY_CREATED") return after.name ?? "";
  return "";
}

/** Who did it, as text: a user's name, or the agent/system label. */
export function describeActor(actor) {
  if (!actor) return "—";
  if (actor.type === "USER") return actor.name ?? actor.email ?? "Unknown user";
  if (actor.type === "AGENT") return "Agent";
  return "System";
}
