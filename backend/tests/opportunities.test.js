import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, makeOpportunity, makeUser, models, setup } from "./helpers.js";

let ctx, owner, admin, analyst, viewer;
before(async () => {
  ctx = await setup();
  [owner, admin, analyst, viewer] = [await makeUser(ctx, "OWNER"), await makeUser(ctx, "ADMIN"), await makeUser(ctx, "ANALYST"), await makeUser(ctx, "VIEWER")];
});
after(() => ctx.cleanup());

describe("opportunity CRUD & RBAC", () => {
  it("creates (201) with status DISCOVERED and audits it; VIEWER cannot create (403)", async () => {
    const res = await as(ctx, analyst).post("/api/opportunities").send({ name: "AI Procurement Intelligence", category: "B2B Software", targetCustomer: { geography: "Ghana" } }).expect(201);
    assert.equal(res.body.data.status, "DISCOVERED");
    assert.equal(res.body.data.slug, "ai-procurement-intelligence");
    assert.equal(res.body.data.createdBy, analyst.id);
    const ev = await models.AuditEvent.findOne({ action: "OPPORTUNITY_CREATED", resourceId: res.body.data.id });
    assert.equal(ev.actorType, "USER");
    assert.equal(String(ev.actorId), analyst.id);
    await as(ctx, viewer).post("/api/opportunities").send({ name: "Nope" }).expect(403);
  });

  it("invalid body is 422; unknown ids are 404; malformed ids are 422; status cannot be set by clients", async () => {
    assert.equal((await as(ctx, analyst).post("/api/opportunities").send({ category: "x" }).expect(422)).body.error.code, "VALIDATION_ERROR");
    assert.equal((await as(ctx, analyst).post("/api/opportunities").send({ name: "x", status: "APPROVED" }).expect(422)).body.error.code, "VALIDATION_ERROR");
    assert.equal((await as(ctx, analyst).post("/api/opportunities").send({ name: "x", pricing: { minimum: 10, maximum: 5 } }).expect(422)).body.error.code, "VALIDATION_ERROR");
    assert.equal((await as(ctx, viewer).get("/api/opportunities/66f123456789abcdef123456").expect(404)).body.error.code, "RESOURCE_NOT_FOUND");
    await as(ctx, viewer).get("/api/opportunities/not-an-id").expect(422);
  });

  it("rejects duplicate names with 409", async () => {
    await makeOpportunity(ctx, analyst, { name: "Dup Test Opp" });
    await as(ctx, analyst).post("/api/opportunities").send({ name: "dup test opp" }).expect(409);
  });

  it("returns detail with related records, updates via PATCH (audited before/after), soft-deletes", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Detail Opp" });
    const upd = await as(ctx, analyst).patch(`/api/opportunities/${opp.id}`).send({ problem: "Slow", risks: [{ description: "Regulatory", severity: "HIGH" }] }).expect(200);
    assert.equal(upd.body.data.problem, "Slow");
    const ev = await models.AuditEvent.findOne({ action: "OPPORTUNITY_UPDATED", resourceId: opp.id });
    assert.equal(ev.after.problem, "Slow");
    const get = await as(ctx, viewer).get(`/api/opportunities/${opp.id}`).expect(200);
    for (const k of ["competitors", "businessModelDetail", "experiments", "sources"]) assert.ok(k in get.body.data, k);
    await as(ctx, viewer).patch(`/api/opportunities/${opp.id}`).send({ problem: "x" }).expect(403);
    await as(ctx, analyst).delete(`/api/opportunities/${opp.id}`).expect(200);
    await as(ctx, analyst).get(`/api/opportunities/${opp.id}`).expect(404);
    assert.ok(await models.AuditEvent.findOne({ action: "OPPORTUNITY_DELETED", resourceId: opp.id }));
  });

  it("blocks Mongo operator injection in body and query", async () => {
    await as(ctx, analyst).post("/api/opportunities").send({ name: { $gt: "" } }).expect(422);
    await as(ctx, analyst).post("/api/opportunities").send({ name: "ok", targetCustomer: { "a.b": 1 } }).expect(422);
    await ctx.http.post("/api/auth/login").send({ email: { $gt: "" }, password: { $gt: "" } }).expect(422);
    await as(ctx, viewer).get("/api/opportunities").query("status[$ne]=X").expect(422);
  });
});

describe("approval workflow & state machine", () => {
  it("ADMIN approves AWAITING_APPROVAL (200); VIEWER and ANALYST get 403", async () => {
    const opp = await makeOpportunity(ctx, analyst, {}, "AWAITING_APPROVAL");
    await as(ctx, viewer).post(`/api/opportunities/${opp.id}/approve`).send({}).expect(403);
    await as(ctx, analyst).post(`/api/opportunities/${opp.id}/approve`).send({}).expect(403);
    const res = await as(ctx, admin).post(`/api/opportunities/${opp.id}/approve`).send({ note: "Looks promising" }).expect(200);
    assert.equal(res.body.data.status, "APPROVED");
    assert.equal(res.body.data.approvedBy, admin.id);
    assert.ok(res.body.data.approvedAt);
    const actions = (await models.AuditEvent.find({ resourceId: opp.id }).sort({ createdAt: 1 })).map((e) => e.action);
    assert.ok(actions.includes("OPPORTUNITY_APPROVED") && actions.includes("OPPORTUNITY_STATUS_CHANGED"));
  });

  it("approving from the wrong state is 409 INVALID_STATE_TRANSITION; a second approval is 409", async () => {
    const early = await makeOpportunity(ctx, analyst, {}, "DISCOVERED");
    const res = await as(ctx, admin).post(`/api/opportunities/${early.id}/approve`).send({}).expect(409);
    assert.equal(res.body.error.code, "INVALID_STATE_TRANSITION");
    const opp = await makeOpportunity(ctx, analyst, {}, "AWAITING_APPROVAL");
    await as(ctx, admin).post(`/api/opportunities/${opp.id}/approve`).send({}).expect(200);
    await as(ctx, admin).post(`/api/opportunities/${opp.id}/approve`).send({}).expect(409);
    await as(ctx, admin).post("/api/opportunities/66f123456789abcdef123456/approve").send({}).expect(404);
  });

  it("concurrent approvals: exactly one succeeds and only one approval is audited", async (t) => {
    if (!ctx.atomic) return t.skip("database does not guarantee atomic conditional updates");
    const opp = await makeOpportunity(ctx, analyst, {}, "AWAITING_APPROVAL");
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => as(ctx, admin).post(`/api/opportunities/${opp.id}/approve`).send({})));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 4);
    assert.equal(await models.AuditEvent.countDocuments({ action: "OPPORTUNITY_APPROVED", resourceId: opp.id }), 1);
  });

  it("rejection requires a reason, records the decision, and REJECTED is terminal", async () => {
    const opp = await makeOpportunity(ctx, analyst, {}, "AWAITING_APPROVAL");
    await as(ctx, admin).post(`/api/opportunities/${opp.id}/reject`).send({}).expect(422);
    const res = await as(ctx, owner).post(`/api/opportunities/${opp.id}/reject`).send({ reason: "Saturated market" }).expect(200);
    assert.equal(res.body.data.status, "REJECTED");
    assert.equal(res.body.data.decision.note, "Saturated market");
    await as(ctx, owner).post(`/api/opportunities/${opp.id}/reject`).send({ reason: "again" }).expect(409);
    await as(ctx, owner).post(`/api/opportunities/${opp.id}/resume`).expect(409);
    await as(ctx, owner).post(`/api/opportunities/${opp.id}/approve`).send({}).expect(409);
  });

  it("pause remembers the prior stage and resume restores it", async () => {
    const opp = await makeOpportunity(ctx, analyst, {}, "AWAITING_APPROVAL");
    const paused = await as(ctx, admin).post(`/api/opportunities/${opp.id}/pause`).send({ note: "waiting" }).expect(200);
    assert.equal(paused.body.data.status, "PAUSED");
    await as(ctx, admin).post(`/api/opportunities/${opp.id}/approve`).send({}).expect(409); // cannot approve while paused
    const back = await as(ctx, admin).post(`/api/opportunities/${opp.id}/resume`).expect(200);
    assert.equal(back.body.data.status, "AWAITING_APPROVAL");
    assert.equal(back.body.data.pausedFromStatus, undefined);
    await as(ctx, admin).post(`/api/opportunities/${opp.id}/resume`).expect(409);
  });
});

describe("listing: pagination, filtering, sorting, search", () => {
  before(async () => {
    await models.Opportunity.deleteMany({});
    for (let i = 1; i <= 25; i++) {
      await makeOpportunity(ctx, analyst, {
        name: `List Item ${String(i).padStart(2, "0")}${i % 5 === 0 ? " widget" : ""}`, category: i % 2 ? "Fintech" : "Health",
        targetCustomer: { geography: i <= 10 ? "Ghana" : "Kenya" }, businessModel: { type: i % 3 ? "SAAS" : "MARKETPLACE" },
      }, i > 20 ? "APPROVED" : "DISCOVERED");
    }
  });

  it("paginates with the standard meta envelope (default 20, max 100)", async () => {
    const p1 = await as(ctx, viewer).get("/api/opportunities").expect(200);
    assert.equal(p1.body.data.length, 20);
    assert.deepEqual(p1.body.meta.pagination, { page: 1, limit: 20, total: 25, pages: 2, hasNextPage: true, hasPreviousPage: false });
    const p2 = await as(ctx, viewer).get("/api/opportunities").query({ page: 2 }).expect(200);
    assert.equal(p2.body.data.length, 5);
    assert.equal(p2.body.meta.pagination.hasNextPage, false);
    assert.equal(p2.body.meta.pagination.hasPreviousPage, true);
    await as(ctx, viewer).get("/api/opportunities").query({ limit: 101 }).expect(422);
    const small = await as(ctx, viewer).get("/api/opportunities").query({ limit: 5, page: 3 }).expect(200);
    assert.equal(small.body.data.length, 5);
    assert.equal(new Set([...p1.body.data, ...p2.body.data].map((o) => o.id)).size, 25); // no duplicates across pages
  });

  it("filters via whitelist and sorts", async () => {
    const f = await as(ctx, viewer).get("/api/opportunities").query({ status: "APPROVED" }).expect(200);
    assert.equal(f.body.meta.pagination.total, 5);
    const g = await as(ctx, viewer).get("/api/opportunities").query({ geography: "Kenya", category: "Fintech" }).expect(200);
    assert.ok(g.body.data.every((o) => o.targetCustomer.geography === "Kenya" && o.category === "Fintech"));
    const m = await as(ctx, viewer).get("/api/opportunities").query({ businessModelType: "MARKETPLACE" }).expect(200);
    assert.ok(m.body.data.length > 0 && m.body.data.every((o) => o.businessModel.type === "MARKETPLACE"));
    const asc = await as(ctx, viewer).get("/api/opportunities").query({ sortBy: "name", order: "asc", limit: 3 }).expect(200);
    assert.deepEqual(asc.body.data.map((o) => o.name), ["List Item 01", "List Item 02", "List Item 03"]);
    await as(ctx, viewer).get("/api/opportunities").query({ sortBy: "passwordHash" }).expect(422);
    await as(ctx, viewer).get("/api/opportunities").query({ unknownFilter: "x" }).expect(422);
  });

  it("searches name/description/problem", async (t) => {
    const res = await as(ctx, viewer).get("/api/opportunities").query({ q: "widget" });
    if (res.status === 500 && ctx.config.SEARCH_MODE === "text") return t.skip("database has no $text support; run with TEST_SEARCH_MODE=regex");
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.pagination.total, 5);
  });

  it("list responses omit heavy evidence/analysis fields", async () => {
    const res = await as(ctx, viewer).get("/api/opportunities").expect(200);
    for (const k of ["evidence", "analysis", "risks"]) assert.equal(k in res.body.data[0], false, k);
  });
});

describe("cross-cutting", () => {
  it("attaches X-Request-ID to every response and echoes a valid inbound one", async () => {
    const a = await ctx.http.get("/api/health");
    assert.match(a.headers["x-request-id"], /^req_/);
    assert.equal(a.body.meta.requestId, a.headers["x-request-id"]);
    const b = await ctx.http.get("/api/health").set("X-Request-ID", "my-trace-id-12345");
    assert.equal(b.headers["x-request-id"], "my-trace-id-12345");
    const c = await ctx.http.get("/api/health").set("X-Request-ID", "bad id with spaces!");
    assert.match(c.headers["x-request-id"], /^req_/);
  });

  it("returns the standard error envelope for malformed JSON and unknown routes", async () => {
    const bad = await ctx.http.post("/api/auth/login").set("Content-Type", "application/json").send("{oops").expect(400);
    assert.equal(bad.body.success, false);
    assert.equal(bad.body.error.code, "VALIDATION_ERROR");
    const nf = await ctx.http.get("/api/nope").expect(404);
    assert.equal(nf.body.error.code, "RESOURCE_NOT_FOUND");
  });

  it("sets secure headers and rejects disallowed CORS origins", async () => {
    const res = await ctx.http.get("/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-powered-by"], undefined);
    await ctx.http.get("/api/health").set("Origin", "https://evil.example").expect(403);
    const ok = await ctx.http.get("/api/health").set("Origin", "http://localhost:3000").expect(200);
    assert.equal(ok.headers["access-control-allow-credentials"], "true");
  });

  it("audit events are append-only", async () => {
    const ev = await models.AuditEvent.findOne();
    ev.action = "USER_LOGIN";
    await assert.rejects(ev.save(), /append-only/);
    await assert.rejects(models.AuditEvent.updateOne({ _id: ev._id }, { $set: { action: "USER_LOGIN" } }), /append-only/);
    await assert.rejects(models.AuditEvent.deleteMany({}), /append-only/);
    await assert.rejects(models.AuditEvent.findOneAndUpdate({ _id: ev._id }, { $set: { actorType: "USER" } }), /append-only/);
  });

  it("audit snapshots never contain secrets", async () => {
    const dump = JSON.stringify(await models.AuditEvent.find());
    assert.equal(/passwordHash|\$2[aby]\$/.test(dump), false);
  });
});
