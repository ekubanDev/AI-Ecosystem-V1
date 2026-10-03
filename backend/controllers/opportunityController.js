import * as svc from "../services/opportunityService.js";
import { ok, paginated } from "../utils/http.js";

export const list = async (req, res) => {
  const { items, total } = await svc.listOpportunities(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};
export const get = async (req, res) => ok(res, await svc.getOpportunity(req.valid.params.id));
export const create = async (req, res) => ok(res, await svc.createOpportunity(req.valid.body, req), { status: 201 });
export const update = async (req, res) => ok(res, await svc.updateOpportunity(req.valid.params.id, req.valid.body, req));
export const remove = async (req, res) => {
  await svc.deleteOpportunity(req.valid.params.id, req);
  return ok(res, { deleted: true });
};
export const approve = async (req, res) => ok(res, await svc.approveOpportunity(req.valid.params.id, req.valid.body, req));
export const reject = async (req, res) => ok(res, await svc.rejectOpportunity(req.valid.params.id, req.valid.body, req));
export const pause = async (req, res) => ok(res, await svc.pauseOpportunity(req.valid.params.id, req.valid.body, req));
export const resume = async (req, res) => ok(res, await svc.resumeOpportunity(req.valid.params.id, req));
export const blueprint = async (req, res) => {
  const { workflowId, taskId } = await req.app.locals.container.orchestrator.startBlueprint(req.valid.params.id, req);
  return ok(res, { workflowId, taskId, status: "QUEUED" }, { status: 202 });
};
export const analyze = async (req, res) => {
  const { workflowId, taskId } = await req.app.locals.container.orchestrator.startAnalysis(req.valid.params.id, req);
  return ok(res, { workflowId, taskId, status: "QUEUED" }, { status: 202 });
};
