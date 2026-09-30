import { getConfig } from "../config/env.js";
import { can } from "../config/permissions.js";
import { Experiment, Opportunity } from "../models/index.js";
import { AppError, forbidden, invalidTransition, notFound } from "../utils/errors.js";
import { buildSort } from "../utils/pagination.js";
import { actorFromReq, audit } from "./auditService.js";
import { transitionOpportunity } from "./opportunityService.js";

export async function listExperiments(q) {
  const filter = {};
  for (const k of ["status", "opportunityId"]) if (q[k]) filter[k] = q[k];
  const sort = buildSort(q.sortBy, q.order, ["createdAt", "updatedAt", "name", "status"]);
  const [items, total] = await Promise.all([
    Experiment.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit),
    Experiment.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getExperiment(id) {
  const exp = await Experiment.findById(id);
  if (!exp) throw notFound("Experiment");
  return exp;
}

const requireExperimentableOpportunity = async (opportunityId) => {
  const opp = await Opportunity.findOne({ _id: opportunityId, isDeleted: { $ne: true } }).select("status");
  if (!opp) throw notFound("Opportunity");
  if (!["APPROVED", "EXPERIMENT"].includes(opp.status)) {
    throw new AppError("INVALID_STATE_TRANSITION", `Experiments can only be created for approved opportunities (this one is ${opp.status}).`);
  }
  return opp;
};

export async function createExperiment(input, req) {
  await requireExperimentableOpportunity(input.opportunityId);
  const exp = await Experiment.create({ ...input, status: "DRAFT", createdBy: req.user.id });
  await audit({ actor: actorFromReq(req), action: "EXPERIMENT_CREATED", resourceType: "Experiment", resourceId: exp._id, after: { name: exp.name, opportunityId: String(exp.opportunityId), budget: exp.budget }, req });
  return exp;
}

export async function updateExperiment(id, patch) {
  const exp = await Experiment.findOneAndUpdate({ _id: id, status: { $in: ["DRAFT", "READY"] } }, { $set: patch }, { returnDocument: "after", runValidators: true });
  if (!exp) return explainMissing(id, "edited");
  return exp;
}

async function explainMissing(id, action) {
  const cur = await Experiment.findById(id).select("status");
  if (!cur) throw notFound("Experiment");
  throw new AppError("INVALID_STATE_TRANSITION", `A ${cur.status} experiment cannot be ${action}.`);
}

export async function startExperiment(id, req) {
  const current = await getExperiment(id);
  // Spending money is a human-approval gate (Blueprint §21): above the threshold only OWNER/ADMIN may start.
  if (current.budget > getConfig().EXPERIMENT_APPROVAL_BUDGET_THRESHOLD && !can(req.user.role, "experiments:approve")) {
    throw forbidden("Starting an experiment with a budget requires OWNER or ADMIN approval.");
  }
  await requireExperimentableOpportunity(current.opportunityId);
  const exp = await Experiment.findOneAndUpdate({ _id: id, status: "READY" }, { $set: { status: "RUNNING", startDate: new Date() } }, { returnDocument: "after" });
  if (!exp) throw invalidTransition((await Experiment.findById(id).select("status"))?.status ?? current.status, "RUNNING");
  await transitionOpportunity({ id: exp.opportunityId, to: "EXPERIMENT", from: "APPROVED", soft: true, actor: actorFromReq(req), req, metadata: { experimentId: String(exp._id) } });
  await audit({ actor: actorFromReq(req), action: "EXPERIMENT_STARTED", resourceType: "Experiment", resourceId: exp._id, before: { status: "READY" }, after: { status: "RUNNING", budget: exp.budget }, req });
  return exp;
}

export async function completeExperiment(id, body, req) {
  const $set = { status: "COMPLETED", endDate: new Date(), results: body.results, conclusion: body.conclusion, nextAction: body.nextAction };
  if (body.metrics) $set.metrics = body.metrics;
  const exp = await Experiment.findOneAndUpdate({ _id: id, status: "RUNNING" }, { $set }, { returnDocument: "after" });
  if (!exp) return explainMissing(id, "completed");
  await audit({ actor: actorFromReq(req), action: "EXPERIMENT_COMPLETED", resourceType: "Experiment", resourceId: exp._id, before: { status: "RUNNING" }, after: { status: "COMPLETED", conclusion: exp.conclusion, nextAction: exp.nextAction }, req });
  return exp;
}

export async function cancelExperiment(id, req) {
  const exp = await Experiment.findOneAndUpdate({ _id: id, status: { $in: ["DRAFT", "READY", "RUNNING"] } }, { $set: { status: "CANCELLED", endDate: new Date() } }, { returnDocument: "before" });
  if (!exp) return explainMissing(id, "cancelled");
  await audit({ actor: actorFromReq(req), action: "EXPERIMENT_CANCELLED", resourceType: "Experiment", resourceId: exp._id, before: { status: exp.status }, after: { status: "CANCELLED" }, req });
  return { ...exp.toJSON(), status: "CANCELLED" };
}
