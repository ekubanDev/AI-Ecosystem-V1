import { describe, expect, it } from "vitest";
import { describeActor, describeAuditEvent } from "../utils/audit.js";

const ev = (o) => ({ before: null, after: null, metadata: null, ...o });

describe("describeAuditEvent", () => {
  it("shows status transitions", () => {
    expect(describeAuditEvent(ev({ action: "OPPORTUNITY_STATUS_CHANGED", before: { status: "AWAITING_APPROVAL" }, after: { status: "APPROVED" } }))).toBe("Awaiting approval → Approved");
  });
  it("shows role and activation changes", () => {
    expect(describeAuditEvent(ev({ action: "USER_ROLE_CHANGED", before: { role: "ANALYST", isActive: true }, after: { role: "VIEWER", isActive: true } }))).toBe("role ANALYST → VIEWER");
    expect(describeAuditEvent(ev({ action: "USER_ROLE_CHANGED", before: { role: "VIEWER", isActive: true }, after: { role: "VIEWER", isActive: false } }))).toBe("deactivated");
  });
  it("lists updated fields, decisions and agent details", () => {
    expect(describeAuditEvent(ev({ action: "OPPORTUNITY_UPDATED", after: { problem: "x", risks: [] } }))).toBe("changed: problem, risks");
    expect(describeAuditEvent(ev({ action: "OPPORTUNITY_REJECTED", metadata: { reason: "Too crowded" } }))).toBe("Too crowded");
    expect(describeAuditEvent(ev({ action: "AGENT_TASK_FAILED", metadata: { agentType: "RESEARCH", error: "quota exceeded" } }))).toBe("Research · error: quota exceeded");
  });
  it("never throws on sparse or unexpected events", () => {
    for (const action of ["USER_LOGIN", "DISCOVERY_COMPLETED", "EXPERIMENT_STARTED", "SYSTEM_CONFIGURATION_CHANGED"]) expect(typeof describeAuditEvent(ev({ action }))).toBe("string");
  });
});

describe("describeActor", () => {
  it("prefers the user's name, then email, and labels non-users", () => {
    expect(describeActor({ type: "USER", name: "Ada", email: "a@x.io" })).toBe("Ada");
    expect(describeActor({ type: "USER", name: null, email: "a@x.io" })).toBe("a@x.io");
    expect(describeActor({ type: "USER" })).toBe("Unknown user");
    expect(describeActor({ type: "AGENT" })).toBe("Agent");
    expect(describeActor({ type: "SYSTEM" })).toBe("System");
  });
});
