import { AgentRun, AgentTask, Experiment, Opportunity } from "../models/index.js";
import { APPROVED_STATUSES, VALIDATED_STATUSES } from "../models/stateMachine.js";

const notDeleted = { isDeleted: { $ne: true } };
const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id ?? "UNCATEGORIZED", r.n]));
const count = (field) => [{ $group: { _id: field, n: { $sum: 1 } } }];

export async function summary() {
  const [byStatus, experimentsRunning, agentsRunning, queued, needsReview, usage] = await Promise.all([
    Opportunity.aggregate([{ $match: notDeleted }, ...count("$status")]),
    Experiment.countDocuments({ status: "RUNNING" }),
    AgentTask.countDocuments({ status: "RUNNING" }),
    AgentTask.countDocuments({ status: { $in: ["QUEUED", "RETRYING"] } }),
    AgentTask.countDocuments({ status: "WAITING_REVIEW" }),
    AgentRun.aggregate([{ $group: { _id: null, cost: { $sum: "$estimatedCost" }, tokens: { $sum: "$tokenUsage.totalTokens" }, runs: { $sum: 1 } } }]),
  ]);
  const s = toMap(byStatus);
  const sum = (statuses) => statuses.reduce((n, k) => n + (s[k] ?? 0), 0);
  return {
    opportunities: Object.values(s).reduce((a, b) => a + b, 0),
    // "validated" = analysis complete or further along; "approved" = a human approved it or it is further along.
    validated: sum(VALIDATED_STATUSES),
    approved: sum(APPROVED_STATUSES),
    awaitingApproval: s.AWAITING_APPROVAL ?? 0,
    experimentsRunning,
    agentsRunning,
    tasksQueued: queued,
    tasksNeedingReview: needsReview,
    ai: { runs: usage[0]?.runs ?? 0, totalTokens: usage[0]?.tokens ?? 0, estimatedCost: usage[0]?.cost ?? 0, note: "estimatedCost only counts runs recorded while AI pricing was configured" },
  };
}

export async function opportunities() {
  const [byStatus, byCategory, recent] = await Promise.all([
    Opportunity.aggregate([{ $match: notDeleted }, ...count("$status")]),
    Opportunity.aggregate([{ $match: notDeleted }, ...count("$category"), { $sort: { n: -1 } }, { $limit: 10 }]),
    Opportunity.find(notDeleted).select("name slug category status targetCustomer businessModel createdAt").sort({ createdAt: -1 }).limit(10),
  ]);
  return { byStatus: toMap(byStatus), byCategory: toMap(byCategory), recent };
}

export async function agentActivity() {
  const [groups, active, recent] = await Promise.all([
    // Grouped by (agent, status) and folded below: keeps the pipeline to plain accumulators that every MongoDB-compatible server supports.
    AgentRun.aggregate([
      {
        $group: {
          _id: { agentType: "$agentType", status: "$status" }, runs: { $sum: 1 }, durationMs: { $sum: "$durationMs" },
          totalTokens: { $sum: "$tokenUsage.totalTokens" }, estimatedCost: { $sum: "$estimatedCost" },
        },
      },
    ]),
    AgentTask.find({ status: { $in: ["RUNNING", "QUEUED", "RETRYING"] } }).select("agentType status workflow opportunityId createdAt").sort({ createdAt: -1 }).limit(20),
    AgentRun.find().select("-input -output").sort({ createdAt: -1 }).limit(10),
  ]);

  const byType = new Map();
  for (const g of groups) {
    const a = byType.get(g._id.agentType) ?? { agentType: g._id.agentType, runs: 0, completed: 0, failed: 0, totalTokens: 0, estimatedCost: 0, _ms: 0, _timed: 0 };
    a.runs += g.runs;
    a.totalTokens += g.totalTokens;
    a.estimatedCost += g.estimatedCost;
    if (g._id.status === "COMPLETED") {
      a.completed += g.runs;
      a._ms += g.durationMs; // only completed runs have a meaningful duration
      a._timed += g.runs;
    }
    if (g._id.status === "FAILED") a.failed += g.runs;
    byType.set(g._id.agentType, a);
  }
  const byAgent = [...byType.values()]
    .map(({ _ms, _timed, ...a }) => ({ ...a, avgDurationMs: _timed ? Math.round(_ms / _timed) : null }))
    .sort((x, y) => x.agentType.localeCompare(y.agentType));
  return { byAgent, active, recent };
}

export async function experiments() {
  const [byStatus, recent, budget] = await Promise.all([
    Experiment.aggregate(count("$status")),
    Experiment.find().sort({ createdAt: -1 }).limit(10),
    Experiment.aggregate([{ $match: { status: "RUNNING" } }, { $group: { _id: "$currency", total: { $sum: "$budget" } } }]),
  ]);
  return { byStatus: toMap(byStatus), recent, runningBudgetByCurrency: toMap(budget.map((b) => ({ _id: b._id, n: b.total }))) };
}
