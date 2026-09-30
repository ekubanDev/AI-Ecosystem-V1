import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, makeUser, models, setup } from "./helpers.js";

let ctx, admin;
before(async () => {
  ctx = await setup({ searchProvider: null });
  admin = await makeUser(ctx, "ADMIN");
});
after(() => ctx.cleanup());

describe("without a search provider agents stay honest", () => {
  it("Scout falls back to KNOWLEDGE_ONLY: no sources, nothing labelled as sourced, uncertainty recorded", async () => {
    await as(ctx, admin).post("/api/agents/opportunity-scout/run").send({ input: { market: "Ghana", targetCount: 5 } }).expect(202);
    await ctx.container.worker.drain();
    const run = await models.AgentRun.findOne({ agentType: "OPPORTUNITY_SCOUT" });
    assert.equal(run.output.mode, "KNOWLEDGE_ONLY");
    assert.equal(run.output.confidence, "LOW");
    assert.match(run.output.uncertainties.join(" "), /No web search was available/);
    assert.equal(await models.Source.countDocuments(), 0);
    assert.equal(ctx.provider.calls.length, 1); // no query-generation call without a search tool
    const opps = await models.Opportunity.find();
    assert.ok(opps.length > 0);
    for (const o of opps) {
      assert.equal(o.sourceIds.length, 0);
      for (const e of o.evidence) {
        assert.ok(["INFERRED", "ASSUMED", "UNKNOWN"].includes(e.evidenceType), `${e.claim}: ${e.evidenceType}`);
        assert.notEqual(e.confidence, "HIGH");
        assert.equal(e.sourceId, undefined);
      }
      for (const d of o.demandSignals) assert.ok(["WEAK", "UNKNOWN"].includes(d.strength));
    }
  });

  it("Research and Competitor report nothing rather than inventing sources or competitors", async () => {
    const opp = await models.Opportunity.findOne();
    const input = { opportunityId: String(opp._id), opportunity: { name: opp.name } };
    ctx.provider.calls.length = 0;
    await as(ctx, admin).post("/api/agents/research/run").send({ input }).expect(202);
    await as(ctx, admin).post("/api/agents/competitor/run").send({ input }).expect(202);
    await ctx.container.worker.drain();
    assert.equal(ctx.provider.calls.length, 0); // no material -> no model call, no hallucination opportunity
    const runs = await models.AgentRun.find({ agentType: { $in: ["RESEARCH", "COMPETITOR"] } });
    assert.equal(runs.length, 2);
    for (const r of runs) {
      assert.equal(r.output.confidence, "UNKNOWN");
      assert.deepEqual(r.output.sources, []);
      assert.match(r.output.uncertainties[0], /No source material/);
    }
    assert.equal(await models.Competitor.countDocuments(), 0);
  });
});
