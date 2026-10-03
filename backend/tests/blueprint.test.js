import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, makeOpportunity, makeUser, models, setup } from "./helpers.js";

let ctx, owner, analyst, viewer;
before(async () => {
  ctx = await setup();
  [owner, analyst, viewer] = [await makeUser(ctx, "OWNER"), await makeUser(ctx, "ANALYST"), await makeUser(ctx, "VIEWER")];
});
after(() => ctx.cleanup());

const generate = async (opp, user = analyst) => {
  const res = await as(ctx, user).post(`/api/opportunities/${opp.id}/blueprint`).expect(202);
  await ctx.container.worker.drain();
  return res;
};

describe("Business Architect blueprint", () => {
  it("is limited to approved opportunities (409), needs agents:run (401/403) and a real opportunity (404)", async () => {
    const early = await makeOpportunity(ctx, analyst, { name: "Not Approved Yet" }, "AWAITING_APPROVAL");
    assert.equal((await as(ctx, analyst).post(`/api/opportunities/${early.id}/blueprint`).expect(409)).body.error.code, "INVALID_STATE_TRANSITION");
    const approved = await makeOpportunity(ctx, analyst, { name: "Approved For Blueprint" }, "APPROVED");
    await ctx.http.post(`/api/opportunities/${approved.id}/blueprint`).expect(401);
    await as(ctx, viewer).post(`/api/opportunities/${approved.id}/blueprint`).expect(403);
    await as(ctx, analyst).post("/api/opportunities/66f123456789abcdef123456/blueprint").expect(404);
    assert.equal(await models.AgentTask.countDocuments({ opportunityId: approved.id, agentType: "BUSINESS_ARCHITECT" }), 0);
  });

  it("drafts and stores a blueprint that shows on the opportunity, with the agent run logged", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Blueprint Happy Path" }, "APPROVED");
    assert.equal((await generate(opp)).body.data.status, "QUEUED");
    const detail = (await as(ctx, viewer).get(`/api/opportunities/${opp.id}`).expect(200)).body.data;
    const b = detail.blueprint;
    assert.match(b.positioning, /Ghanaian SME/);
    assert.equal(b.version, 1);
    assert.equal(b.generatedByAgent, "BUSINESS_ARCHITECT");
    assert.deepEqual(b.mvpScope.notNow, ["Mobile app"]);
    const run = await models.AgentRun.findOne({ agentType: "BUSINESS_ARCHITECT", status: "COMPLETED" }).sort({ createdAt: -1 });
    assert.ok(run, "agent run recorded for cost and debugging");
  });

  it("enforces the planning rules in code, whatever the model says", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Blueprint Guards" }, "APPROVED");
    await generate(opp);
    const b = (await as(ctx, owner).get(`/api/opportunities/${opp.id}`)).body.data.blueprint;
    assert.equal(b.brandOptions.length, 5, "capped at five brand ideas");
    const [starter, growth] = b.pricingHypotheses;
    assert.equal(starter.price, 10);
    assert.equal(starter.evidenceType, "INFERRED", "no sources here, so nothing can be VERIFIED");
    assert.equal(growth.price, null, "a price without a stated basis is removed");
    assert.match(growth.basis, /No basis stated/);
    const gated = Object.fromEntries(b.launchChecklist.map((c) => [c.item, c.requiresHumanApproval]));
    assert.equal(gated["Compile the first report"], false);
    assert.equal(gated["Run paid ads on social media"], true, "paid advertising always needs the owner");
    assert.equal(gated["Register the business name"], true, "legal steps always need the owner");
    assert.match(b.uncertainties.join(" "), /trademarks has NOT been checked/);
    assert.match(b.uncertainties.join(" "), /No validation experiment has been completed/);
    assert.notEqual(b.confidence, "HIGH", "a plan never claims HIGH confidence");
  });

  it("regenerating replaces the draft and bumps the version; two at once is refused (409)", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Blueprint Regenerate" }, "APPROVED");
    await generate(opp);
    await generate(opp);
    assert.equal((await as(ctx, owner).get(`/api/opportunities/${opp.id}`)).body.data.blueprint.version, 2);
    assert.equal(await models.Blueprint.countDocuments({ opportunityId: opp.id }), 1);
    await as(ctx, analyst).post(`/api/opportunities/${opp.id}/blueprint`).expect(202);
    assert.equal((await as(ctx, analyst).post(`/api/opportunities/${opp.id}/blueprint`).expect(409)).body.error.code, "RESOURCE_CONFLICT");
    await ctx.container.worker.drain();
  });

  it("stores nothing when the opportunity was paused before the agent finished", async () => {
    const opp = await makeOpportunity(ctx, analyst, { name: "Blueprint Paused Midway" }, "APPROVED");
    await as(ctx, analyst).post(`/api/opportunities/${opp.id}/blueprint`).expect(202);
    await as(ctx, owner).post(`/api/opportunities/${opp.id}/pause`).send({}).expect(200);
    await ctx.container.worker.drain();
    assert.equal(await models.Blueprint.countDocuments({ opportunityId: opp.id }), 0);
  });

  it("is registered with least-privilege permissions: no external access, writes only the blueprint", async () => {
    const agent = ctx.container.registry.get("BUSINESS_ARCHITECT");
    assert.deepEqual(agent.permissions.external, []);
    assert.deepEqual(agent.permissions.write, ["blueprint"]);
  });
});
