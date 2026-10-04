import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import request from "supertest";
import { leadLimiter } from "../middleware/rateLimit.js";
import { errorHandler } from "../middleware/errorMiddleware.js";
import { as, makeOpportunity, makeUser, models, setup } from "./helpers.js";

let ctx, owner, admin, analyst, viewer, opp;
const page = (slug) => `/api/public/landing/${slug}`;
const form = (over = {}) => ({ name: "Ama Mensah", email: "ama@example.com", company: "Mensah Supplies", sector: "Agri inputs", consent: true, ...over });
const anon = () => ctx.http;

before(async () => {
  ctx = await setup();
  [owner, admin, analyst, viewer] = [await makeUser(ctx, "OWNER"), await makeUser(ctx, "ADMIN"), await makeUser(ctx, "ANALYST"), await makeUser(ctx, "VIEWER")];
  opp = await makeOpportunity(ctx, analyst, { name: "Ghana Directory" }, "APPROVED");
});
after(() => ctx.cleanup());

describe("publishing a landing page", () => {
  it("is private by default and 404s identically for unknown pages", async () => {
    const a = await anon().get(page(opp.slug)).expect(404);
    const b = await anon().get(page("no-such-page")).expect(404);
    assert.equal(a.body.error.code, b.body.error.code);
  });

  it("requires landing:publish: 401 anonymous, 403 for ANALYST and VIEWER; 422 on invalid input", async () => {
    const body = { enabled: true, headline: "Find reliable suppliers in Ghana" };
    await ctx.http.put(`/api/opportunities/${opp.id}/landing`).send(body).expect(401);
    await as(ctx, analyst).put(`/api/opportunities/${opp.id}/landing`).send(body).expect(403);
    await as(ctx, viewer).put(`/api/opportunities/${opp.id}/landing`).send(body).expect(403);
    assert.equal((await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: true }).expect(422)).body.error.code, "VALIDATION_ERROR"); // no headline
    await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: false, bullets: Array(7).fill("x") }).expect(422);
    await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: false, surprise: 1 }).expect(422);
  });

  it("cannot publish for an opportunity that is not approved (409)", async () => {
    const early = await makeOpportunity(ctx, analyst, { name: "Not Yet Approved" }, "AWAITING_APPROVAL");
    assert.equal((await as(ctx, owner).put(`/api/opportunities/${early.id}/landing`).send({ enabled: true, headline: "h" }).expect(409)).body.error.code, "INVALID_STATE_TRANSITION");
  });

  it("publishes, is audited, and the public page exposes only the public fields", async () => {
    const res = await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({
      enabled: true, headline: "Find reliable suppliers in Ghana", subheadline: "Verified listings", bullets: ["Verified profiles", "Direct contact"], ctaLabel: "Register my interest",
    }).expect(200);
    assert.equal(res.body.data.enabled, true);
    assert.ok(await models.AuditEvent.findOne({ action: "LANDING_PAGE_UPDATED", resourceId: opp.id }));
    const pub = (await anon().get(page(opp.slug)).expect(200)).body.data;
    assert.deepEqual(Object.keys(pub).sort(), ["bullets", "consentText", "ctaLabel", "headline", "name", "slug", "subheadline"]);
    assert.equal(pub.headline, "Find reliable suppliers in Ghana");
    assert.match(pub.consentText, /Ghana Directory/);
  });

  it("goes dark again when the opportunity is paused or the page is switched off", async () => {
    await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: false }).expect(200);
    await anon().get(page(opp.slug)).expect(404);
    await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: true, headline: "Find reliable suppliers in Ghana" }).expect(200);
    await anon().get(page(opp.slug)).expect(200);
    await as(ctx, owner).post(`/api/opportunities/${opp.id}/pause`).send({}).expect(200);
    await anon().get(page(opp.slug)).expect(404);
    await as(ctx, owner).post(`/api/opportunities/${opp.id}/resume`).expect(200);
  });
});

describe("public lead capture", () => {
  it("stores a lead with the consent wording and time, and keeps personal data out of the audit trail", async () => {
    const res = await anon().post(`${page(opp.slug)}/leads`).send(form()).expect(201);
    assert.deepEqual(res.body.data, { received: true });
    const lead = await models.Lead.findOne({ email: "ama@example.com" });
    assert.equal(String(lead.opportunityId), opp.id);
    assert.equal(lead.status, "NEW");
    assert.match(lead.consent.text, /Ghana Directory/);
    assert.ok(lead.consent.at instanceof Date);
    const ev = await models.AuditEvent.findOne({ action: "LEAD_CAPTURED", resourceId: lead._id });
    assert.ok(ev);
    assert.doesNotMatch(JSON.stringify(ev.toObject()), /ama@example\.com|Ama Mensah|Mensah Supplies/);
  });

  it("requires explicit consent and valid fields (422) and rejects unknown fields", async () => {
    await anon().post(`${page(opp.slug)}/leads`).send(form({ consent: false })).expect(422);
    const { consent, ...noConsent } = form();
    await anon().post(`${page(opp.slug)}/leads`).send(noConsent).expect(422);
    await anon().post(`${page(opp.slug)}/leads`).send(form({ email: "not-an-email" })).expect(422);
    await anon().post(`${page(opp.slug)}/leads`).send(form({ name: "" })).expect(422);
    await anon().post(`${page(opp.slug)}/leads`).send(form({ opportunityId: "66f123456789abcdef123456" })).expect(422);
  });

  it("treats a repeat email as the same lead and answers identically", async () => {
    const before = await models.Lead.countDocuments();
    const res = await anon().post(`${page(opp.slug)}/leads`).send(form({ name: "Ama again" })).expect(201);
    assert.deepEqual(res.body.data, { received: true });
    assert.equal(await models.Lead.countDocuments(), before);
    assert.equal((await models.Lead.findOne({ email: "ama@example.com" })).name, "Ama Mensah"); // the first submission stands
  });

  it("silently drops honeypot submissions and refuses unpublished pages", async () => {
    const before = await models.Lead.countDocuments();
    await anon().post(`${page(opp.slug)}/leads`).send(form({ email: "bot@example.com", website: "http://spam.example" })).expect(201);
    assert.equal(await models.Lead.countDocuments(), before);
    await anon().post(`${page("no-such-page")}/leads`).send(form({ email: "x@example.com" })).expect(404);
  });
});

describe("working the leads", () => {
  let lead;
  before(async () => { lead = await models.Lead.findOne({ email: "ama@example.com" }); });

  it("lists leads for OWNER/ADMIN/ANALYST only (401 anonymous, 403 VIEWER) with pagination and filters", async () => {
    await ctx.http.get("/api/leads").expect(401);
    await as(ctx, viewer).get("/api/leads").expect(403);
    const res = await as(ctx, analyst).get(`/api/leads?opportunityId=${opp.id}&status=NEW`).expect(200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].email, "ama@example.com");
    assert.equal(res.body.meta.pagination.total, 1);
    await as(ctx, analyst).get("/api/leads?status=BOGUS").expect(422);
    await as(ctx, analyst).get("/api/leads?opportunityId=nope").expect(422);
  });

  it("updates status and notes (audited without personal data); VIEWER cannot; invalid is 422", async () => {
    await as(ctx, viewer).patch(`/api/leads/${lead.id}`).send({ status: "CONTACTED" }).expect(403);
    await as(ctx, analyst).patch(`/api/leads/${lead.id}`).send({ status: "NOPE" }).expect(422);
    await as(ctx, analyst).patch(`/api/leads/${lead.id}`).send({}).expect(422);
    const res = await as(ctx, analyst).patch(`/api/leads/${lead.id}`).send({ status: "QUALIFIED", notes: "Wants a quote" }).expect(200);
    assert.equal(res.body.data.status, "QUALIFIED");
    const ev = await models.AuditEvent.findOne({ action: "LEAD_UPDATED", resourceId: lead._id });
    assert.deepEqual([ev.before.status, ev.after.status], ["NEW", "QUALIFIED"]);
    assert.doesNotMatch(JSON.stringify(ev.toObject()), /Wants a quote|ama@example\.com/);
  });

  it("really deletes a lead on request (consent promises it) and audits the deletion", async () => {
    await anon().post(`${page(opp.slug)}/leads`).send(form({ email: "gone@example.com", name: "Kofi" })).expect(201);
    const doomed = await models.Lead.findOne({ email: "gone@example.com" });
    await as(ctx, viewer).delete(`/api/leads/${doomed.id}`).expect(403);
    await as(ctx, analyst).delete(`/api/leads/${doomed.id}`).expect(200);
    assert.equal(await models.Lead.findById(doomed.id), null);
    assert.ok(await models.AuditEvent.findOne({ action: "LEAD_DELETED", resourceId: doomed._id }));
    await as(ctx, analyst).delete(`/api/leads/${doomed.id}`).expect(404);
  });
});

describe("lead form rate limit", () => {
  it("answers 429 RATE_LIMIT_EXCEEDED once an address exceeds the limit", async () => {
    const app = express();
    app.post("/leads", leadLimiter({ RATE_LIMIT_ENABLED: true, LEAD_RATE_LIMIT_MAX: 2 }), (_req, res) => res.status(201).json({ ok: true }));
    app.use(errorHandler);
    await request(app).post("/leads").expect(201);
    await request(app).post("/leads").expect(201);
    assert.equal((await request(app).post("/leads").expect(429)).body.error.code, "RATE_LIMIT_EXCEEDED");
  });
});

describe("landing analytics", () => {
  const stats = async (user = viewer) => (await as(ctx, user).get(`/api/opportunities/${opp.id}/landing-stats`).expect(200)).body.data;

  it("counts views of a published page only, with a source tag, and 404s for unpublished or unknown pages", async () => {
    const before = await stats();
    await anon().post(`${page(opp.slug)}/view`).send({}).expect(202);
    await anon().post(`${page(opp.slug)}/view`).send({ source: "WhatsApp" }).expect(202);
    await anon().post(`${page(opp.slug)}/view`).send({ source: "whatsapp" }).expect(202);
    const after = await stats();
    assert.equal(after.views, before.views + 3);
    assert.equal(after.bySource.find((s) => s.source === "whatsapp").views, 2, "source is normalized to lower case");
    assert.ok(after.lastViewAt);

    await anon().post(`${page("no-such-page")}/view`).send({}).expect(404);
    await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: false }).expect(200);
    await anon().post(`${page(opp.slug)}/view`).send({}).expect(404);
    assert.equal((await stats()).views, after.views, "an unpublished page records nothing");
    await as(ctx, admin).put(`/api/opportunities/${opp.id}/landing`).send({ enabled: true, headline: "Find reliable suppliers in Ghana" }).expect(200);
  });

  it("rejects unknown fields (422) so the endpoint cannot be used to smuggle identifiers in", async () => {
    await anon().post(`${page(opp.slug)}/view`).send({ visitorId: "abc" }).expect(422);
    await anon().post(`${page(opp.slug)}/view`).send({ source: "x".repeat(101) }).expect(422);
  });

  it("stores counters only: no IP address, user agent or visitor id", async () => {
    const row = (await models.LandingStat.findOne({ opportunityId: opp.id }).lean());
    assert.deepEqual(Object.keys(row).sort(), ["__v", "_id", "day", "lastViewAt", "opportunityId", "source", "views"].filter((k) => k in row).sort());
    assert.doesNotMatch(JSON.stringify(row), /ip|agent|visitor|cookie/i);
  });

  it("reports views, leads and conversion (capped at 100%), by day and by source; readable by every role, not anonymously", async () => {
    await ctx.http.get(`/api/opportunities/${opp.id}/landing-stats`).expect(401);
    const s = await stats(analyst);
    assert.ok(s.views >= 3);
    assert.equal(s.leads, await models.Lead.countDocuments({ opportunityId: opp.id }));
    assert.equal(s.conversionRate, Math.round(Math.min(1, s.leads / s.views) * 10000) / 10000);
    assert.equal(s.byDay.length, 30);
    const today = s.byDay.at(-1);
    assert.equal(today.day, new Date().toISOString().slice(0, 10));
    assert.equal(today.views, s.views);
    assert.equal(s.byDay.reduce((n, d) => n + d.leads, 0), s.leads);
  });

  it("gives null conversion when there are no views yet, and 404 for an unknown opportunity", async () => {
    const fresh = await makeOpportunity(ctx, analyst, { name: "No Views Yet" }, "APPROVED");
    const s = (await as(ctx, viewer).get(`/api/opportunities/${fresh.id}/landing-stats`).expect(200)).body.data;
    assert.deepEqual([s.views, s.leads, s.conversionRate, s.lastViewAt], [0, 0, null, null]);
    await as(ctx, viewer).get("/api/opportunities/66f123456789abcdef123456/landing-stats").expect(404);
  });

  it("rate-limits view pings per address (429)", async () => {
    const { viewLimiter } = await import("../middleware/rateLimit.js");
    const app = express();
    app.post("/v", viewLimiter({ RATE_LIMIT_ENABLED: true, VIEW_RATE_LIMIT_MAX: 2 }), (_req, res) => res.status(202).json({ ok: true }));
    app.use(errorHandler);
    await request(app).post("/v").expect(202);
    await request(app).post("/v").expect(202);
    await request(app).post("/v").expect(429);
  });
});

describe("privacy", () => {
  it("never stores a visitor's IP address or browser in the audit trail when they submit the form", async () => {
    await anon().post(`${page(opp.slug)}/leads`).send(form({ email: "private@example.com", name: "Private Person" })).set("User-Agent", "SecretBrowser/9.9").expect(201);
    const lead = await models.Lead.findOne({ email: "private@example.com" });
    const ev = await models.AuditEvent.findOne({ action: "LEAD_CAPTURED", resourceId: lead._id }).lean();
    assert.ok(ev.requestId, "the request id is kept for debugging");
    assert.equal(ev.ipAddress, undefined);
    assert.equal(ev.userAgent, undefined);
    assert.doesNotMatch(JSON.stringify(ev), /SecretBrowser|127\.0\.0\.1|::1/);
  });

  it("publishes who is responsible for the data on a public endpoint", async () => {
    assert.deepEqual((await anon().get("/api/public/privacy").expect(200)).body.data, { operatorName: "Test Operator Ltd", contactEmail: "privacy@test.example", configured: true });
  });

  it("in production, refuses to publish a page until the operator is named (and is relaxed in development)", async () => {
    const { assertCanPublish, privacyContact } = await import("../services/landingService.js");
    assert.throws(() => assertCanPublish({ isProd: true }), (e) => e.code === "RESOURCE_CONFLICT" && /PRIVACY_OPERATOR_NAME/.test(e.message));
    assert.throws(() => assertCanPublish({ isProd: true, PRIVACY_OPERATOR_NAME: "Acme Ltd" }), (e) => e.code === "RESOURCE_CONFLICT", "both name and email are needed");
    assert.doesNotThrow(() => assertCanPublish({ isProd: true, PRIVACY_OPERATOR_NAME: "Acme Ltd", PRIVACY_CONTACT_EMAIL: "privacy@acme.test" }));
    assert.doesNotThrow(() => assertCanPublish({ isProd: false }));
    assert.equal(privacyContact({}).configured, false);
  });
});
