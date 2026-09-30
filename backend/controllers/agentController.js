import { AgentTask, DiscoveryRun } from "../models/index.js";
import { audit, actorFromReq } from "../services/auditService.js";
import * as tasks from "../services/taskService.js";
import { AppError } from "../utils/errors.js";
import { ok, paginated } from "../utils/http.js";

const c = (req) => req.app.locals.container;

export const list = async (req, res) => ok(res, c(req).registry.list().map((a) => a.describe()));

export const listRuns = async (req, res) => {
  const { items, total } = await tasks.listRuns(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};
export const getRun = async (req, res) => ok(res, await tasks.getRun(req.valid.params.id));

export const listTasks = async (req, res) => {
  const { items, total } = await tasks.listTasks(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};
export const getTask = async (req, res) => ok(res, await tasks.getTask(req.valid.params.id));

export const run = async (req, res) => {
  const task = await c(req).orchestrator.startManualTask({ agentType: req.valid.params.agentType, ...req.valid.body }, req);
  return ok(res, { taskId: String(task._id), status: task.status }, { status: 202 });
};

/** Re-queues a FAILED / WAITING_REVIEW task (human decision after automatic retries were exhausted or the error was permanent). */
export const retryTask = async (req, res) => {
  const before = await tasks.getTask(req.valid.params.id);
  const task = await AgentTask.findOneAndUpdate(
    { _id: before._id, status: { $in: ["FAILED", "WAITING_REVIEW"] } },
    { $set: { status: "QUEUED", retryCount: 0, runAfter: new Date() }, $unset: { error: 1, errorType: 1, startedAt: 1, completedAt: 1 } },
    { returnDocument: "after" }
  );
  if (!task) throw new AppError("INVALID_STATE_TRANSITION", `A ${before.status} task cannot be retried.`);
  if (task.workflow === "DISCOVERY") {
    const run = await DiscoveryRun.findById(task.workflowId).select("status");
    if (run?.status === "CANCELLED") {
      await AgentTask.updateOne({ _id: task._id }, { $set: { status: "CANCELLED" } });
      throw new AppError("INVALID_STATE_TRANSITION", "The discovery run was cancelled.");
    }
    await c(req).orchestrator.reopenRun(task.workflowId);
  }
  await audit({ actor: actorFromReq(req), action: "AGENT_TASK_RETRIED", resourceType: "AgentTask", resourceId: task._id, before: { status: before.status }, after: { status: "QUEUED" }, metadata: { manual: true }, req });
  return ok(res, { taskId: String(task._id), status: task.status }, { status: 202 });
};
