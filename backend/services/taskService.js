import { AGENT_TYPES } from "../models/constants.js";
import { AgentRun, AgentTask } from "../models/index.js";
import { AppError, notFound } from "../utils/errors.js";
import { buildSort } from "../utils/pagination.js";
import { AGENT_ACTOR, actorFromReq, audit } from "./auditService.js";

/** Creates a queued task. Returns null when a task with the same dedupeKey already exists (idempotent chain steps). */
export async function createTask({ agentType, workflowId, workflow, objective, input, priority = "NORMAL", requestedBy, opportunityId, dedupeKey, actor, req }) {
  if (!AGENT_TYPES.includes(agentType)) throw new AppError("VALIDATION_ERROR", `Unknown agent type ${agentType}`);
  let task;
  try {
    task = await AgentTask.create({ agentType, workflowId, workflow, objective, input, priority, requestedBy, opportunityId, dedupeKey });
  } catch (err) {
    if (err.code === 11000 && dedupeKey) return null;
    throw err;
  }
  await audit({
    actor: actor ?? actorFromReq(req), action: "AGENT_TASK_CREATED", resourceType: "AgentTask", resourceId: task._id,
    metadata: { agentType, workflow, workflowId, opportunityId: opportunityId && String(opportunityId) }, req,
  });
  return task;
}

const paginate = async (Model, filter, q, sortable, projection) => {
  const sort = buildSort(q.sortBy, q.order, sortable);
  const [items, total] = await Promise.all([
    Model.find(filter).select(projection ?? "").sort(sort).skip((q.page - 1) * q.limit).limit(q.limit),
    Model.countDocuments(filter),
  ]);
  return { items, total };
};

const pick = (q, keys) => Object.fromEntries(keys.filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));

export const listRuns = (q) => paginate(AgentRun, pick(q, ["agentType", "status", "taskId"]), q, ["createdAt", "startedAt", "durationMs"], "-input -output");

export async function getRun(id) {
  const run = await AgentRun.findById(id);
  if (!run) throw notFound("Agent run");
  return run;
}

export const listTasks = (q) => paginate(AgentTask, pick(q, ["agentType", "status", "workflowId", "opportunityId"]), q, ["createdAt", "startedAt", "priority"], "-input -outputSchema");

export async function getTask(id) {
  const task = await AgentTask.findById(id);
  if (!task) throw notFound("Agent task");
  return task;
}

export { AGENT_ACTOR };
