import crypto from "node:crypto";
import { APPROVED_STATUSES } from "../models/constants.js";
import { AgentTask, BusinessModel, Competitor, DiscoveryRun, Experiment, Opportunity, Source } from "../models/index.js";
import { AppError, conflict, notFound } from "../utils/errors.js";
import { AGENT_ACTOR, actorFromReq, audit } from "../services/auditService.js";
import { transitionOpportunity } from "../services/opportunityService.js";
import { createTask } from "../services/taskService.js";
import { abortRegistry } from "./abortRegistry.js";
import {
  assertWritePermission, persistAnalysis, persistBlueprint, persistBusinessModel, persistCompetitors, persistResearch, persistScout,
} from "./persistence.js";
import { ANALYSIS_CHAIN, WORKFLOWS, isChainAgent, nextInChain } from "./workflowRegistry.js";

const ACTIVE_TASK = ["QUEUED", "RUNNING", "RETRYING"];
const oppActor = (agentType, task) => ({ ...AGENT_ACTOR(agentType), metadata: { agentType, taskId: String(task._id) } });

const snapshot = (o) => ({
  name: o.name, category: o.category, description: o.description, targetCustomer: o.targetCustomer, problem: o.problem,
  proposedSolution: o.proposedSolution, businessModel: o.businessModel, pricing: o.pricing, acquisitionChannels: o.acquisitionChannels,
});
const evidenceList = (o) => o.evidence.slice(0, 200).map((e) => ({ claim: e.claim, evidenceType: e.evidenceType, area: e.area }));

/**
 * Coordinates the DISCOVERY and ANALYSIS workflows. Steps are AgentTasks executed by the worker; when a task succeeds
 * (`onTaskSucceeded`) its output is persisted and the next step is queued, so progress survives restarts.
 */
export function createOrchestrator({ registry }) {
  /** Builds a chain task's input from current database state (not from the previous task's output) so re-runs see fresh data. */
  async function buildInput(agentType, oppId, extras = {}) {
    const opp = await Opportunity.findById(oppId);
    if (!opp) throw notFound("Opportunity");
    const base = { opportunityId: String(oppId), opportunity: snapshot(opp) };
    switch (agentType) {
      case "RESEARCH": {
        const sources = await Source.find({ _id: { $in: opp.sourceIds } }).select("url").limit(10);
        return { ...base, researchQuestions: [], existingSources: sources.map((s) => ({ sourceId: String(s._id), url: s.url })) };
      }
      case "COMPETITOR":
        return { ...base, competitors: extras.competitorLeads ?? [], evidence: evidenceList(opp) };
      case "BUSINESS_MODEL": {
        const comps = await Competitor.find({ opportunityId: oppId }).limit(20);
        return { ...base, evidence: evidenceList(opp), competitors: comps.map((c) => ({ name: c.name, pricing: c.pricing, businessModel: c.businessModel, weaknesses: c.weaknesses })) };
      }
      case "OPPORTUNITY_ANALYST": {
        const [comps, bm] = await Promise.all([Competitor.find({ opportunityId: oppId }).limit(20), BusinessModel.findOne({ opportunityId: oppId })]);
        return {
          ...base, evidence: evidenceList(opp), businessModel: bm ? { ...bm.toObject(), _id: undefined, opportunityId: undefined } : null,
          competitors: comps.map((c) => ({ name: c.name, pricing: c.pricing, businessModel: c.businessModel, strengths: c.strengths, weaknesses: c.weaknesses })),
        };
      }
      default:
        throw new AppError("AGENT_ERROR", `No chain input for ${agentType}`);
    }
  }

  /** Everything the Business Architect may read, loaded fresh so a regenerated blueprint sees new evidence and experiment results. */
  async function buildBlueprintInput(oppId) {
    const opp = await Opportunity.findById(oppId);
    if (!opp) throw notFound("Opportunity");
    const [comps, bm, experiments] = await Promise.all([
      Competitor.find({ opportunityId: oppId }).limit(20), BusinessModel.findOne({ opportunityId: oppId }), Experiment.find({ opportunityId: oppId }).sort({ createdAt: -1 }).limit(10),
    ]);
    return {
      opportunityId: String(oppId), opportunity: snapshot(opp), evidence: evidenceList(opp),
      businessModel: bm ? { ...bm.toObject(), _id: undefined, opportunityId: undefined } : null,
      analysis: opp.analysis?.assessment ? { assessment: opp.analysis.assessment, risks: opp.risks, validationPlan: opp.validationPlan } : null,
      competitors: comps.map((c) => ({ name: c.name, pricing: c.pricing, businessModel: c.businessModel, strengths: c.strengths, weaknesses: c.weaknesses })),
      experiments: experiments.map((e) => ({ name: e.name, status: e.status, hypothesis: e.hypothesis, results: e.results, conclusion: e.conclusion })),
    };
  }

  async function enqueueChainStep({ agentType, workflow, workflowId, oppId, requestedBy, extras }) {
    const input = await buildInput(agentType, oppId, extras);
    return createTask({
      agentType, workflow, workflowId, objective: registry.get(agentType).objective, input, requestedBy, opportunityId: oppId,
      dedupeKey: `${workflowId}:${agentType}:${oppId}`, actor: { type: "SYSTEM" },
    });
  }

  async function oppIsLive(oppId) {
    const o = await Opportunity.findOne({ _id: oppId, isDeleted: { $ne: true } }).select("status");
    return o && !["PAUSED", "REJECTED"].includes(o.status) ? o : null;
  }

  const bumpRun = (runId, inc) => DiscoveryRun.updateOne({ _id: runId }, { $inc: inc });

  const orchestrator = {
    // ---- starting workflows ---------------------------------------------------------------------------------

    async startDiscovery(request, req) {
      const run = await DiscoveryRun.create({ request, requestedBy: req.user.id, status: "QUEUED" });
      const scoutInput = {
        market: request.market,
        geography: request.geography ?? [request.market],
        categories: request.categories ?? (request.customerType ? [`${request.customerType} businesses`] : []),
        revenueModels: request.revenuePreference ?? [],
        targetCount: request.count,
        objective: request.objective,
        constraints: request.constraints,
      };
      await createTask({
        agentType: "OPPORTUNITY_SCOUT", workflow: WORKFLOWS.DISCOVERY, workflowId: String(run._id), objective: request.objective ?? registry.get("OPPORTUNITY_SCOUT").objective,
        input: scoutInput, requestedBy: req.user.id, priority: "NORMAL", dedupeKey: `${run._id}:OPPORTUNITY_SCOUT:run`, req,
      });
      await audit({ actor: actorFromReq(req), action: "DISCOVERY_STARTED", resourceType: "DiscoveryRun", resourceId: run._id, metadata: { request }, req });
      return run;
    },

    /** Runs Research → Competitor → Business model → Analyst for an existing opportunity. */
    async startAnalysis(oppId, req) {
      const opp = await Opportunity.findOne({ _id: oppId, isDeleted: { $ne: true } }).select("status");
      if (!opp) throw notFound("Opportunity");
      if (!["DISCOVERED", "RESEARCHING", "ANALYZING", "VALIDATED", "AWAITING_APPROVAL"].includes(opp.status)) {
        throw new AppError("INVALID_STATE_TRANSITION", `Opportunities in ${opp.status} cannot be re-analyzed.`);
      }
      if (await AgentTask.exists({ opportunityId: oppId, status: { $in: ACTIVE_TASK } })) throw conflict("An analysis is already in progress for this opportunity.");
      const workflowId = crypto.randomUUID();
      await transitionOpportunity({ id: oppId, to: "RESEARCHING", from: "DISCOVERED", soft: true, actor: actorFromReq(req), req });
      const task = await enqueueChainStep({ agentType: "RESEARCH", workflow: WORKFLOWS.ANALYSIS, workflowId, oppId, requestedBy: req.user.id });
      return { workflowId, taskId: task._id };
    },

    /** Drafts the business blueprint. Only for opportunities a human has approved: the agent never plans a business nobody said yes to. */
    async startBlueprint(oppId, req) {
      const opp = await Opportunity.findOne({ _id: oppId, isDeleted: { $ne: true } }).select("status");
      if (!opp) throw notFound("Opportunity");
      if (!APPROVED_STATUSES.includes(opp.status)) {
        throw new AppError("INVALID_STATE_TRANSITION", `A blueprint can only be drafted for an approved opportunity (this one is ${opp.status}).`);
      }
      if (await AgentTask.exists({ opportunityId: oppId, agentType: "BUSINESS_ARCHITECT", status: { $in: ACTIVE_TASK } })) throw conflict("A blueprint is already being drafted for this opportunity.");
      const workflowId = crypto.randomUUID();
      const task = await createTask({
        agentType: "BUSINESS_ARCHITECT", workflow: WORKFLOWS.MANUAL, workflowId, objective: registry.get("BUSINESS_ARCHITECT").objective,
        input: await buildBlueprintInput(oppId), requestedBy: req.user.id, opportunityId: oppId, req,
      });
      return { workflowId, taskId: task._id };
    },

    /** Direct single-agent execution (OWNER/ADMIN). Output is persisted but nothing chains. */
    async startManualTask({ agentType, input, objective, priority }, req) {
      const agent = registry.get(agentType);
      const parsed = agent.parseInput(input); // fail fast with 422 rather than queueing a doomed task
      if (parsed.opportunityId && !(await Opportunity.exists({ _id: parsed.opportunityId, isDeleted: { $ne: true } }))) throw notFound("Opportunity");
      return createTask({
        agentType, workflow: WORKFLOWS.MANUAL, workflowId: crypto.randomUUID(), objective: objective ?? agent.objective, input: parsed, priority,
        requestedBy: req.user.id, opportunityId: parsed.opportunityId, req,
      });
    },

    async cancelDiscovery(runId, req) {
      const run = await DiscoveryRun.findOneAndUpdate(
        { _id: runId, status: { $in: ["QUEUED", "RUNNING"] } }, { $set: { status: "CANCELLED", completedAt: new Date(), stage: "CANCELLED" } }, { returnDocument: "after" }
      );
      if (!run) {
        const existing = await DiscoveryRun.findById(runId).select("status");
        if (!existing) throw notFound("Discovery run");
        throw new AppError("INVALID_STATE_TRANSITION", `Discovery run is already ${existing.status}.`);
      }
      await AgentTask.updateMany({ workflowId: String(runId), status: { $in: ["QUEUED", "RETRYING"] } }, { $set: { status: "CANCELLED", completedAt: new Date() } });
      abortRegistry.abortWorkflow(String(runId));
      await audit({ actor: actorFromReq(req), action: "DISCOVERY_CANCELLED", resourceType: "DiscoveryRun", resourceId: runId, req });
      return run;
    },

    // ---- callbacks from the task runner ---------------------------------------------------------------------

    async onTaskStarted(task) {
      if (task.workflow === WORKFLOWS.DISCOVERY) await DiscoveryRun.updateOne({ _id: task.workflowId, status: "QUEUED" }, { $set: { status: "RUNNING", startedAt: new Date() } });
    },

    /** Persist the agent's output (permission-checked) and queue whatever follows. Throwing here fails the task. */
    async onTaskSucceeded(task, output, agent) {
      assertWritePermission(agent);
      const isDiscovery = task.workflow === WORKFLOWS.DISCOVERY;
      const run = isDiscovery ? await DiscoveryRun.findById(task.workflowId) : null;
      if (isDiscovery && (!run || run.status === "CANCELLED")) return; // cancelled while running: discard

      if (task.agentType === "OPPORTUNITY_SCOUT") {
        const geo = run ? (run.request.geography ?? [run.request.market]).join(", ") : undefined;
        const { created, duplicates } = await persistScout(output, { agent, run, requestedBy: task.requestedBy, defaults: { geography: geo } });
        if (run) {
          await DiscoveryRun.updateOne(
            { _id: run._id },
            { $inc: { "stats.candidates": output.opportunities.length, "stats.duplicatesSkipped": duplicates, "stats.opportunitiesCreated": created.length }, $set: { stage: "RESEARCHING" }, $addToSet: { opportunityIds: { $each: created.map((o) => o._id) } } }
          );
          for (const opp of created) {
            await transitionOpportunity({ id: opp._id, to: "RESEARCHING", from: "DISCOVERED", soft: true, actor: oppActor(agent.agentType, task) });
            await enqueueChainStep({ agentType: "RESEARCH", workflow: WORKFLOWS.DISCOVERY, workflowId: String(run._id), oppId: opp._id, requestedBy: task.requestedBy });
          }
        }
        return;
      }

      const oppId = task.opportunityId;
      if (task.agentType === "BUSINESS_ARCHITECT") {
        if (oppId && (await oppIsLive(oppId))) await persistBlueprint(oppId, output); // paused/rejected/deleted meanwhile: discard
        return;
      }
      if (!isChainAgent(task.agentType) || !oppId) return;

      if (task.workflow !== WORKFLOWS.MANUAL && !(await oppIsLive(oppId))) {
        if (run) await bumpRun(run._id, { "stats.opportunitiesSkipped": 1 });
        return; // paused / rejected / deleted mid-pipeline: stop quietly
      }

      if (task.agentType === "RESEARCH") await persistResearch(oppId, output);
      else if (task.agentType === "COMPETITOR") await persistCompetitors(oppId, output);
      else if (task.agentType === "BUSINESS_MODEL") await persistBusinessModel(oppId, output);
      else if (task.agentType === "OPPORTUNITY_ANALYST") await persistAnalysis(oppId, output);

      if (task.workflow === WORKFLOWS.MANUAL) return;

      const next = nextInChain(task.agentType);
      const actor = oppActor(agent.agentType, task);
      if (next) {
        if (next === "OPPORTUNITY_ANALYST") await transitionOpportunity({ id: oppId, to: "ANALYZING", from: "RESEARCHING", soft: true, actor });
        await enqueueChainStep({ agentType: next, workflow: task.workflow, workflowId: task.workflowId, oppId, requestedBy: task.requestedBy, extras: { competitorLeads: output.competitorLeads } });
      } else {
        // Analysis finished. VALIDATED = analysed with evidence attached (not "proven profitable"); a human decides next.
        await transitionOpportunity({ id: oppId, to: "VALIDATED", from: "ANALYZING", soft: true, actor });
        await transitionOpportunity({ id: oppId, to: "AWAITING_APPROVAL", from: "VALIDATED", soft: true, actor });
        if (run) await bumpRun(run._id, { "stats.opportunitiesCompleted": 1 });
      }
    },

    /** Called after a task reaches FAILED / WAITING_REVIEW for good. */
    async onTaskTerminalFailure(task) {
      if (task.workflow === WORKFLOWS.DISCOVERY && task.agentType !== "OPPORTUNITY_SCOUT") await bumpRun(task.workflowId, { "stats.opportunitiesFailed": 1 });
    },

    /** Re-evaluates a discovery run after any of its tasks settles; completes it once nothing is active. */
    async refreshRun(workflowId) {
      if (!/^[a-f0-9]{24}$/i.test(String(workflowId))) return;
      const run = await DiscoveryRun.findById(workflowId);
      if (!run || !["QUEUED", "RUNNING"].includes(run.status)) return;
      if (await AgentTask.exists({ workflowId: String(workflowId), status: { $in: ACTIVE_TASK } })) return;

      const scout = await AgentTask.findOne({ workflowId: String(workflowId), agentType: "OPPORTUNITY_SCOUT" }).select("status error");
      const failed = !scout || scout.status !== "COMPLETED";
      const done = await DiscoveryRun.findOneAndUpdate(
        { _id: workflowId, status: { $in: ["QUEUED", "RUNNING"] } },
        { $set: { status: failed ? "FAILED" : "COMPLETED", stage: failed ? "FAILED" : "COMPLETED", completedAt: new Date(), ...(failed ? { error: scout?.error ?? "Scout did not complete" } : {}) } },
        { returnDocument: "after" }
      );
      if (done) await audit({ actor: { type: "SYSTEM" }, action: "DISCOVERY_COMPLETED", resourceType: "DiscoveryRun", resourceId: done._id, metadata: { status: done.status, stats: done.stats } });
    },

    /** Re-opens a finished run when one of its tasks is manually retried. */
    async reopenRun(workflowId) {
      if (/^[a-f0-9]{24}$/i.test(String(workflowId))) {
        await DiscoveryRun.updateOne({ _id: workflowId, status: { $in: ["COMPLETED", "FAILED"] } }, { $set: { status: "RUNNING" }, $unset: { completedAt: 1, error: 1 } });
      }
    },

    // ---- read models ----------------------------------------------------------------------------------------

    /** Progress in the stages the UI shows: Discovering → Researching → Analyzing → Structuring → Completed. */
    async describeRun(run) {
      const rows = await AgentTask.aggregate([{ $match: { workflowId: String(run._id) } }, { $group: { _id: { agentType: "$agentType", status: "$status" }, n: { $sum: 1 } } }]);
      const tasks = {};
      for (const r of rows) (tasks[r._id.agentType] ??= {})[r._id.status] = r.n;
      const completedSteps = ANALYSIS_CHAIN.reduce((n, a) => n + (tasks[a]?.COMPLETED ?? 0), 0);
      const total = run.stats.opportunitiesCreated * ANALYSIS_CHAIN.length;
      const scoutDone = tasks.OPPORTUNITY_SCOUT?.COMPLETED > 0;
      let percent = run.status === "COMPLETED" ? 100 : !scoutDone ? (run.status === "RUNNING" ? 10 : 0) : total ? Math.min(99, Math.round(20 + 80 * (completedSteps / total))) : 20;
      const stage = ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status) ? run.status : !scoutDone ? "DISCOVERING" : completedSteps < total / 2 ? "RESEARCHING" : "ANALYZING";
      return { ...run.toJSON(), progress: { stage, percent }, tasks };
    },
  };
  return orchestrator;
}
