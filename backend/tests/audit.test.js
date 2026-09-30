import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AUDIT_ACTIONS } from "../models/constants.js";
import { as, makeOpportunity, makeUser, models, setup } from "./helpers.js";

let ctx, owner, admin, analyst, viewer, opp;

before(async () => {
  ctx = await setup();
  [owner, admin, analyst, viewer] = [await makeUser(ctx, "OWNER"), await makeUser(ctx, "ADMIN"), await makeUser(ctx, "ANALYST"), await makeUser(ctx, "VIEWER")];
  opp = await makeOpportunity(ctx, analyst, { name: "Audited Opportunity" }, "AWAITING_APPROVAL");
  await as(ctx, admin).post(`/api/opportunities/${opp.id}/approve`).send({ note: "ok" }).expect(200);
  // Agent-authored events: a direct Scout run.
  await as(ctx, admin).post("/api/agents/opportunity-scout/run").send({ input: { market: "Ghana", targetCount: 3 } }).expect(202);
  await ctx.container.worker.drain();
});
after(() => ctx.cleanup());

describe("GET /api/audit — access", () => {
  it("requires authentication and OWNER/ADMIN", async () => {
    assert.equal((await ctx.http.get("/api/audit").expect(401)).body.error.code, "AUTH_REQUIRED");
    for (const u of [analyst, viewer]) assert.equal((await as(ctx, u).get("/api/audit").expect(403)).body.error.code, "FORBIDDEN");
    for (const u of [owner, admin]) await as(ctx, u).get("/api/audit").expect(200);
    await as(ctx, analyst).get("/api/audit/facets").expect(403);
  });
});

describe("GET /api/audit — data", () => {
  it("returns newest first with the standard pagination envelope and resolved actor names", async () => {
    const res = await as(ctx, admin).get("/api/audit").query({ limit: 5 }).expect(200);
    assert.equal(res.body.data.length, 5);
    const times = res.body.data.map((e) => new Date(e.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.equal(res.body.meta.pagination.limit, 5);
    assert.ok(res.body.meta.pagination.total > 5);
    assert.equal(res.body.meta.pagination.hasNextPage, true);

    const approved = (await as(ctx, admin).get("/api/audit").query({ action: "OPPORTUNITY_APPROVED" }).expect(200)).body.data[0];
    assert.equal(approved.actor.type, "USER");
    assert.equal(approved.actor.id, admin.id);
    assert.equal(approved.actor.email, admin.email);
    assert.equal(approved.actor.role, "ADMIN");
    assert.ok(approved.id && !("_id" in approved));
    assert.equal(approved.resourceType, "Opportunity");
    assert.equal(approved.metadata.note, "ok");
    assert.ok(approved.requestId);
  });

  it("filters by resource to give one opportunity's history in chronological order", async () => {
    const res = await as(ctx, admin).get("/api/audit").query({ resourceType: "Opportunity", resourceId: opp.id, order: "asc" }).expect(200);
    const actions = res.body.data.map((e) => e.action);
    assert.equal(actions.length, 3);
    assert.equal(actions[0], "OPPORTUNITY_CREATED");
    assert.ok(actions.indexOf("OPPORTUNITY_STATUS_CHANGED") > 0 && actions.includes("OPPORTUNITY_APPROVED"));
    assert.ok(res.body.data.every((e) => String(e.resourceId) === opp.id));
    const change = res.body.data.find((e) => e.action === "OPPORTUNITY_STATUS_CHANGED");
    assert.deepEqual([change.before.status, change.after.status], ["AWAITING_APPROVAL", "APPROVED"]);
  });

  it("filters by actor, actor type and action; agent events have no user name", async () => {
    const mine = await as(ctx, owner).get("/api/audit").query({ actorId: analyst.id }).expect(200);
    assert.ok(mine.body.data.length > 0 && mine.body.data.every((e) => e.actor.id === analyst.id));
    const agents = await as(ctx, owner).get("/api/audit").query({ actorType: "AGENT" }).expect(200);
    assert.ok(agents.body.data.length > 0);
    for (const e of agents.body.data) assert.deepEqual([e.actor.type, e.actor.name], ["AGENT", null]);
    const runs = await as(ctx, owner).get("/api/audit").query({ action: "AGENT_RUN_COMPLETED" }).expect(200);
    assert.equal(runs.body.meta.pagination.total, 1);
  });

  it("filters by date range", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    assert.equal((await as(ctx, admin).get("/api/audit").query({ from: future }).expect(200)).body.meta.pagination.total, 0);
    assert.equal((await as(ctx, admin).get("/api/audit").query({ to: past }).expect(200)).body.meta.pagination.total, 0);
    const inRange = await as(ctx, admin).get("/api/audit").query({ from: past, to: future }).expect(200);
    assert.equal(inRange.body.meta.pagination.total, await models.AuditEvent.countDocuments());
    await as(ctx, admin).get("/api/audit").query({ from: future, to: past }).expect(422);
    await as(ctx, admin).get("/api/audit").query({ from: "not-a-date" }).expect(422);
  });

  it("paginates without gaps or duplicates", async () => {
    const total = await models.AuditEvent.countDocuments();
    const seen = new Set();
    for (let page = 1; page <= Math.ceil(total / 25); page++) {
      const res = await as(ctx, admin).get("/api/audit").query({ page, limit: 25 }).expect(200);
      res.body.data.forEach((e) => seen.add(e.id));
    }
    assert.equal(seen.size, total);
  });

  it("validates filters and rejects injection attempts", async () => {
    await as(ctx, admin).get("/api/audit").query({ action: "NOT_AN_ACTION" }).expect(422);
    await as(ctx, admin).get("/api/audit").query({ resourceType: "passwords" }).expect(422);
    await as(ctx, admin).get("/api/audit").query({ resourceId: "nope" }).expect(422);
    await as(ctx, admin).get("/api/audit").query({ limit: 101 }).expect(422);
    await as(ctx, admin).get("/api/audit").query({ sortBy: "before" }).expect(422);
    await as(ctx, admin).get("/api/audit").query({ unknown: "x" }).expect(422);
    await as(ctx, admin).get("/api/audit").query("actorId[$ne]=x").expect(422);
  });

  it("never exposes secrets and is read-only", async () => {
    const dump = JSON.stringify((await as(ctx, admin).get("/api/audit").query({ limit: 100 }).expect(200)).body);
    assert.equal(/passwordHash|\$2[aby]\$|TokenHash|refreshTokenVersion/.test(dump), false);
    await as(ctx, admin).post("/api/audit").send({}).expect(404);
    await as(ctx, admin).patch("/api/audit").send({}).expect(404);
    await as(ctx, admin).delete("/api/audit").expect(404);
  });

  it("facets list every server-side action", async () => {
    const res = await as(ctx, admin).get("/api/audit/facets").expect(200);
    assert.deepEqual(res.body.data.actions, AUDIT_ACTIONS);
    assert.ok(res.body.data.resourceTypes.includes("Opportunity"));
  });
});
