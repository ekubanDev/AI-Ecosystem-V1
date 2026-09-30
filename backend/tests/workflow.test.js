import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, makeOpportunity, makeUser, models, setup, tokenFromEmail } from "./helpers.js";

let ctx, admin, analyst, viewer;
const drain = () => ctx.container.worker.drain();
const discovery = { objective: "Find B2B opportunities adaptable to Ghana.", count: 20, market: "Ghana", customerType: "B2B", revenuePreference: ["SUBSCRIPTION"] };

before(async () => {
  ctx = await setup();
  [admin, analyst, viewer] = [await makeUser(ctx, "ADMIN"), await makeUser(ctx, "ANALYST"), await makeUser(ctx, "VIEWER")];
});
after(() => ctx.cleanup());

describe("End-to-end acceptance: discovery → analysis → approval → experiment (spec §37)", () => {
  let runId, opps;

  it("Register → verify email → login (real flow, first account is OWNER)", async () => {
    await models.User.deleteMany({ email: "founder@example.com" });
    await ctx.http.post("/api/auth/register").send({ name: "Founder", email: "founder@example.com", password: "StrongPassword123!" }).expect(201);
    await ctx.http.post("/api/auth/login").send({ email: "founder@example.com", password: "StrongPassword123!" }).expect(403);
    await ctx.http.get("/api/auth/verify-email").query({ token: tokenFromEmail(ctx.emails, "founder@example.com") }).expect(200);
    await ctx.http.post("/api/auth/login").send({ email: "founder@example.com", password: "StrongPassword123!" }).expect(200);
  });

  it("starts a discovery run (202) with permission and validation checks; Idempotency-Key replays safely", async () => {
    await as(ctx, viewer).post("/api/discovery/run").send(discovery).expect(403);
    await as(ctx, analyst).post("/api/discovery/run").send({ ...discovery, count: 0 }).expect(422);
    await as(ctx, analyst).post("/api/discovery/run").send({ ...discovery, count: 51 }).expect(422);
    await as(ctx, analyst).post("/api/discovery/run").send({ market: "Ghana", bogus: true }).expect(422);

    const first = await as(ctx, analyst).post("/api/discovery/run").set("Idempotency-Key", "discovery-2026-001").send(discovery).expect(202);
    assert.equal(first.body.data.status, "QUEUED");
    runId = first.body.data.runId;
    const replay = await as(ctx, analyst).post("/api/discovery/run").set("Idempotency-Key", "discovery-2026-001").send(discovery).expect(202);
    assert.equal(replay.body.data.runId, runId);
    assert.equal(replay.headers["idempotent-replayed"], "true");
    await as(ctx, analyst).post("/api/discovery/run").set("Idempotency-Key", "discovery-2026-001").send({ ...discovery, count: 5 }).expect(409);
    await as(ctx, analyst).post("/api/discovery/run").set("Idempotency-Key", "x").send(discovery).expect(422);
    assert.equal(await models.DiscoveryRun.countDocuments({ _id: runId }), 1);
    assert.equal(await models.AgentTask.countDocuments({ workflowId: runId }), 1);

    const before = await as(ctx, viewer).get(`/api/discovery/runs/${runId}`).expect(200);
    assert.equal(before.body.data.status, "QUEUED");
    assert.equal(before.body.data.progress.percent, 0);
  });

  it("runs Scout → Research → Competitor → Business Model → Analyst and completes the run", async () => {
    const executed = await drain();
    assert.equal(executed, 1 + 2 * 4); // scout + 2 opportunities x 4 chain steps

    const run = (await as(ctx, viewer).get(`/api/discovery/runs/${runId}`).expect(200)).body.data;
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.progress.percent, 100);
    assert.equal(run.progress.stage, "COMPLETED");
    assert.equal(run.stats.candidates, 2);
    assert.equal(run.stats.opportunitiesCreated, 2);
    assert.equal(run.stats.opportunitiesCompleted, 2);
    assert.equal(run.stats.opportunitiesFailed, 0);
    assert.equal(run.tasks.RESEARCH.COMPLETED, 2);
    assert.equal(run.tasks.OPPORTUNITY_ANALYST.COMPLETED, 2);

    const list = await as(ctx, viewer).get("/api/discovery/runs").expect(200);
    assert.equal(list.body.meta.pagination.total, 1);
    assert.equal((await models.AgentRun.find({ status: "COMPLETED" })).length, 9);
  });

  it("persists evidence-backed opportunities that wait for human approval", async () => {
    const list = await as(ctx, viewer).get("/api/opportunities").query({ status: "AWAITING_APPROVAL" }).expect(200);
    assert.equal(list.body.meta.pagination.total, 2);
    const pp = list.body.data.find((o) => o.name === "Procure Pilot");
    opps = list.body.data;

    const d = (await as(ctx, viewer).get(`/api/opportunities/${pp.id}`).expect(200)).body.data;
    assert.equal(d.discoveryRunId, runId);
    assert.equal(d.targetCustomer.geography, "Ghana");

    // Evidence: every sourced claim resolves to a stored Source; the uncited "VERIFIED" claims were downgraded.
    const sourced = d.evidence.filter((e) => ["VERIFIED", "SUPPORTED"].includes(e.evidenceType));
    assert.ok(sourced.length >= 4);
    for (const e of sourced) assert.ok(d.sources.some((s) => s.id === e.sourceId), `evidence "${e.claim}" must point at a stored source`);
    const uncited = d.evidence.find((e) => e.claim === "Revenue is subscription based");
    assert.equal(uncited.evidenceType, "INFERRED");
    assert.equal(uncited.sourceId, undefined);
    assert.deepEqual(new Set(d.evidence.map((e) => e.area)), new Set(["initial", "market", "customer", "pricing", "competitor", "businessModel"]));
    assert.ok(d.sources.length >= 3 && d.sources.every((s) => /^https:\/\//.test(s.url) && s.retrievedAt));

    // Research-derived pricing needs a cited source and is stored with its evidence.
    assert.deepEqual([d.pricing.minimum, d.pricing.maximum, d.pricing.currency], [10, 50, "USD"]);
    assert.match(d.pricing.pricingEvidence, /\$10/);

    // Competitors: invented pricing/complaints (invalid source ref) were stripped, cited ones kept.
    const acme = d.competitors.find((c) => c.name === "Acme Procure");
    const hub = d.competitors.find((c) => c.name === "Supplier Hub");
    assert.equal(acme.pricing, "From $10/mo");
    assert.ok(acme.evidenceIds.length > 0);
    assert.equal(hub.pricing, null);
    assert.deepEqual(hub.customerComplaints, []);
    assert.equal(d.competitors.length, 2);

    // Business model: fields claiming evidence without valid citations were downgraded.
    const bm = d.businessModelDetail;
    assert.equal(bm.customer, "SME distributors");
    assert.equal(bm.evidenceTypes.customer, "SUPPORTED");
    assert.equal(bm.evidenceTypes.acquisition, "INFERRED"); // cited ref 999 which does not exist
    assert.equal(bm.evidenceTypes.pricing, "VERIFIED"); // cites evidence #3, which exists, so the claim stands
    assert.equal(bm.evidenceTypes.upsell, "UNKNOWN");
    assert.notEqual(bm.confidence, "HIGH");
    assert.equal(d.businessModel.type, "SUBSCRIPTION");

    // Analysis: assessment, complexity, risks, differentiation, validation plan, hypotheses, and estimates flagged with basis.
    assert.equal(d.analysis.assessment.demand.value, "MODERATE");
    assert.equal(d.complexity.capital, "MEDIUM"); // LOW_TO_MEDIUM maps to the more conservative MEDIUM
    assert.equal(d.risks[0].severity, "HIGH");
    assert.equal(d.differentiation[0].idea, "Local supplier database");
    assert.equal(d.validationPlan.successCriteria, "3 paid pilots");
    assert.equal(d.hypotheses[0].status, "UNTESTED");
    assert.ok(d.economics.basis);
    assert.notEqual(d.economics.confidence, "HIGH"); // estimates never exceed MEDIUM
    assert.ok(d.uncertainties.includes("Traction is unknown"));
    assert.ok(d.analyzedAt);
  });

  it("keeps a complete, ordered audit trail of the pipeline", async () => {
    const pp = opps.find((o) => o.name === "Procure Pilot");
    const events = await models.AuditEvent.find({ resourceType: "Opportunity", resourceId: pp.id }).sort({ createdAt: 1, _id: 1 });
    assert.equal(events[0].action, "OPPORTUNITY_CREATED");
    assert.equal(events[0].actorType, "AGENT");
    const path = events.filter((e) => e.action === "OPPORTUNITY_STATUS_CHANGED").map((e) => `${e.before.status}>${e.after.status}`);
    assert.deepEqual(path, ["DISCOVERED>RESEARCHING", "RESEARCHING>ANALYZING", "ANALYZING>VALIDATED", "VALIDATED>AWAITING_APPROVAL"]);
    for (const e of events.filter((x) => x.action === "OPPORTUNITY_STATUS_CHANGED")) assert.equal(e.actorType, "AGENT");
    const runEvents = await models.AuditEvent.find({ resourceType: "DiscoveryRun", resourceId: runId });
    assert.deepEqual(runEvents.map((e) => e.action).sort(), ["DISCOVERY_COMPLETED", "DISCOVERY_STARTED"]);
    assert.equal(await models.AuditEvent.countDocuments({ action: "AGENT_TASK_COMPLETED" }), 9);
  });

  it("a second run skips duplicates instead of recreating opportunities", async () => {
    const r = await as(ctx, analyst).post("/api/discovery/run").send(discovery).expect(202);
    await drain();
    const run = (await as(ctx, viewer).get(`/api/discovery/runs/${r.body.data.runId}`).expect(200)).body.data;
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.stats.duplicatesSkipped, 2);
    assert.equal(run.stats.opportunitiesCreated, 0);
    assert.equal(await models.Opportunity.countDocuments(), 2);
  });

  it("human approval → experiment lifecycle with the spending gate → results → audit", async () => {
    const pp = opps.find((o) => o.name === "Procure Pilot");
    const expBody = { opportunityId: pp.id, name: "Landing Page Demand Test", hypothesis: "5% of visitors submit interest.", method: "Landing page + outbound", budget: 500, currency: "ghs", successCriteria: "20 qualified leads" };

    await as(ctx, analyst).post("/api/experiments").send(expBody).expect(409); // not approved yet
    await as(ctx, analyst).post(`/api/opportunities/${pp.id}/approve`).send({}).expect(403);
    await as(ctx, admin).post(`/api/opportunities/${pp.id}/approve`).send({ note: "Go" }).expect(200);

    await as(ctx, viewer).post("/api/experiments").send(expBody).expect(403);
    await as(ctx, analyst).post("/api/experiments").send({ ...expBody, opportunityId: "66f123456789abcdef123456" }).expect(404);
    await as(ctx, analyst).post("/api/experiments").send({ ...expBody, budget: -5 }).expect(422);
    const created = await as(ctx, analyst).post("/api/experiments").send(expBody).expect(201);
    const id = created.body.data.id;
    assert.equal(created.body.data.status, "DRAFT");
    assert.equal(created.body.data.currency, "GHS");

    await as(ctx, admin).post(`/api/experiments/${id}/start`).expect(409); // a DRAFT experiment must be marked READY first
    await as(ctx, analyst).patch(`/api/experiments/${id}`).send({ status: "READY" }).expect(200);
    await as(ctx, analyst).post(`/api/experiments/${id}/start`).expect(403); // budget > 0 needs OWNER/ADMIN
    const started = await as(ctx, admin).post(`/api/experiments/${id}/start`).set("Idempotency-Key", "start-exp-0001").expect(200);
    assert.equal(started.body.data.status, "RUNNING");
    assert.ok(started.body.data.startDate);
    const replay = await as(ctx, admin).post(`/api/experiments/${id}/start`).set("Idempotency-Key", "start-exp-0001").expect(200);
    assert.equal(replay.headers["idempotent-replayed"], "true");
    await as(ctx, admin).post(`/api/experiments/${id}/start`).expect(409);
    await as(ctx, analyst).patch(`/api/experiments/${id}`).send({ name: "edit while running" }).expect(409);
    assert.equal((await models.Opportunity.findById(pp.id)).status, "EXPERIMENT");

    await as(ctx, analyst).post(`/api/experiments/${id}/complete`).send({ results: "x" }).expect(422);
    const done = await as(ctx, analyst).post(`/api/experiments/${id}/complete`).send({
      results: "22 qualified leads from 410 visitors", conclusion: "Demand signal supports a paid pilot.", nextAction: "Run 3 paid pilots",
      metrics: [{ name: "qualified leads", target: 20, actual: 22 }],
    }).expect(200);
    assert.equal(done.body.data.status, "COMPLETED");
    assert.equal(done.body.data.metrics[0].actual, 22);
    await as(ctx, analyst).post(`/api/experiments/${id}/complete`).send({ results: "a", conclusion: "b", nextAction: "c" }).expect(409);
    await as(ctx, analyst).post(`/api/experiments/${id}/cancel`).expect(409);

    const actions = (await models.AuditEvent.find({ resourceType: "Experiment", resourceId: id }).sort({ createdAt: 1 })).map((e) => e.action);
    assert.deepEqual(actions, ["EXPERIMENT_CREATED", "EXPERIMENT_STARTED", "EXPERIMENT_COMPLETED"]);
    const oppPath = (await models.AuditEvent.find({ resourceType: "Opportunity", resourceId: pp.id, action: "OPPORTUNITY_STATUS_CHANGED" }).sort({ createdAt: 1, _id: 1 })).map((e) => e.after.status);
    assert.deepEqual(oppPath.slice(-2), ["APPROVED", "EXPERIMENT"]);

    const detail = (await as(ctx, viewer).get(`/api/opportunities/${pp.id}`).expect(200)).body.data;
    assert.equal(detail.experiments.length, 1);
    const list = await as(ctx, viewer).get("/api/experiments").query({ opportunityId: pp.id, status: "COMPLETED" }).expect(200);
    assert.equal(list.body.meta.pagination.total, 1);
  });

  it("dashboard reflects the whole flow", async () => {
    const s = (await as(ctx, viewer).get("/api/dashboard/summary").expect(200)).body.data;
    assert.equal(s.opportunities, 2);
    assert.equal(s.approved, 1);
    assert.equal(s.validated, 2);
    assert.equal(s.awaitingApproval, 1);
    assert.equal(s.experimentsRunning, 0);
    assert.equal(s.agentsRunning, 0);
    const o = (await as(ctx, viewer).get("/api/dashboard/opportunities").expect(200)).body.data;
    assert.equal(o.byStatus.EXPERIMENT, 1);
    assert.equal(o.byStatus.AWAITING_APPROVAL, 1);
    assert.equal(o.recent.length, 2);
    const a = (await as(ctx, viewer).get("/api/dashboard/agent-activity").expect(200)).body.data;
    assert.equal(a.byAgent.length, 5);
    assert.ok(a.byAgent.every((x) => x.completed > 0 && x.failed === 0));
    const e = (await as(ctx, viewer).get("/api/dashboard/experiments").expect(200)).body.data;
    assert.equal(e.byStatus.COMPLETED, 1);
  });

  it("agent run history is inspectable (input, output, sources, tokens) without bloating lists", async () => {
    const list = await as(ctx, viewer).get("/api/agents/runs").query({ agentType: "RESEARCH" }).expect(200);
    assert.equal(list.body.meta.pagination.total, 2);
    assert.equal("output" in list.body.data[0], false);
    const one = await as(ctx, viewer).get(`/api/agents/runs/${list.body.data[0].id}`).expect(200);
    assert.ok(one.body.data.output.marketEvidence.length);
    assert.ok(one.body.data.input.opportunity.name);
    assert.ok(one.body.data.sourcesUsed.length > 0);
    assert.equal(one.body.data.tokenUsage.totalTokens, 300);
  });
});

describe("workflow edge cases", () => {
  it("cancels a queued discovery run (409 if already finished)", async () => {
    const r = await as(ctx, analyst).post("/api/discovery/run").send({ ...discovery, market: "Kenya" }).expect(202);
    const id = r.body.data.runId;
    await as(ctx, viewer).post(`/api/discovery/runs/${id}/cancel`).expect(403);
    const c = await as(ctx, analyst).post(`/api/discovery/runs/${id}/cancel`).expect(200);
    assert.equal(c.body.data.status, "CANCELLED");
    assert.equal((await models.AgentTask.findOne({ workflowId: id })).status, "CANCELLED");
    assert.equal(await drain(), 0);
    await as(ctx, analyst).post(`/api/discovery/runs/${id}/cancel`).expect(409);
    assert.ok(await models.AuditEvent.findOne({ action: "DISCOVERY_CANCELLED", resourceId: id }));
    await as(ctx, viewer).get("/api/discovery/runs/66f123456789abcdef123456").expect(404);
  });

  it("a failing Scout marks the run FAILED with the reason", async () => {
    const { AppError } = await import("../utils/errors.js");
    ctx.provider.failNext(1, () => new AppError("EXTERNAL_SERVICE_ERROR", "invalid api key", { retryable: false }));
    const r = await as(ctx, analyst).post("/api/discovery/run").send({ ...discovery, market: "Nigeria" }).expect(202);
    await drain();
    const run = (await as(ctx, viewer).get(`/api/discovery/runs/${r.body.data.runId}`).expect(200)).body.data;
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /invalid api key/);
  });

  it("analyze runs the chain for an existing opportunity; only one analysis at a time; permissions enforced", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Manual Analysis Target" });
    await as(ctx, viewer).post(`/api/opportunities/${opp.id}/analyze`).expect(403);
    const res = await as(ctx, analyst).post(`/api/opportunities/${opp.id}/analyze`).expect(202);
    assert.equal(res.body.data.status, "QUEUED");
    await as(ctx, analyst).post(`/api/opportunities/${opp.id}/analyze`).expect(409);
    assert.equal(await drain(), 4);
    assert.equal((await models.Opportunity.findById(opp.id)).status, "AWAITING_APPROVAL");
    assert.equal((await models.Competitor.countDocuments({ opportunityId: opp.id })), 2);
    // Re-analysis of an opportunity that is already AWAITING_APPROVAL refreshes data without regressing its status.
    await as(ctx, analyst).post(`/api/opportunities/${opp.id}/analyze`).expect(202);
    await drain();
    assert.equal((await models.Opportunity.findById(opp.id)).status, "AWAITING_APPROVAL");
    assert.equal(await models.Competitor.countDocuments({ opportunityId: opp.id }), 2); // upserted, not duplicated
    assert.equal(await models.BusinessModel.countDocuments({ opportunityId: opp.id }), 1);
    const approved = await makeOpportunity(ctx, analyst, {}, "APPROVED");
    await as(ctx, analyst).post(`/api/opportunities/${approved.id}/analyze`).expect(409);
  });

  it("stops the chain quietly when the opportunity is rejected mid-pipeline", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Rejected Midway" });
    await as(ctx, analyst).post(`/api/opportunities/${opp.id}/analyze`).expect(202);
    await as(ctx, admin).post(`/api/opportunities/${opp.id}/reject`).send({ reason: "changed mind" }).expect(200);
    assert.equal(await drain(), 1); // the research task ran, nothing followed
    const o = await models.Opportunity.findById(opp.id);
    assert.equal(o.status, "REJECTED");
    assert.equal(o.evidence.length, 0);
    assert.equal(await models.AgentTask.countDocuments({ opportunityId: opp.id }), 1);
  });

  it("failed chain steps are visible, retryable by a human, and the run continues afterwards", async () => {
    const { AppError } = await import("../utils/errors.js");
    const r = await as(ctx, analyst).post("/api/discovery/run").send({ ...discovery, market: "Uganda" }).expect(202);
    const runId = r.body.data.runId;
    await models.Opportunity.deleteMany({});
    // Scout succeeds, then the first Research call fails permanently.
    let researchCalls = 0;
    ctx.provider.responder = (label, prompt) => {
      if (label === "Research Agent" && !/search queries/i.test(prompt) && researchCalls++ === 0) throw new AppError("EXTERNAL_SERVICE_ERROR", "quota exceeded", { retryable: false });
      return undefined;
    };
    await drain();
    ctx.provider.responder = null;
    let run = (await as(ctx, viewer).get(`/api/discovery/runs/${runId}`).expect(200)).body.data;
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.stats.opportunitiesFailed, 1);
    assert.equal(run.stats.opportunitiesCompleted, 1);
    const failed = await models.AgentTask.findOne({ workflowId: runId, status: "FAILED" });
    assert.match(failed.error, /quota exceeded/);
    const dash = (await as(ctx, viewer).get("/api/dashboard/summary").expect(200)).body.data;
    assert.ok(dash.tasksNeedingReview >= 0);

    await as(ctx, admin).post(`/api/agents/tasks/${failed._id}/retry`).expect(202);
    assert.equal((await models.DiscoveryRun.findById(runId)).status, "RUNNING"); // reopened
    await drain();
    run = (await as(ctx, viewer).get(`/api/discovery/runs/${runId}`).expect(200)).body.data;
    assert.equal(run.status, "COMPLETED");
    assert.equal(await models.Opportunity.countDocuments({ status: "AWAITING_APPROVAL", discoveryRunId: runId }), 2);
  });
});
