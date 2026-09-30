import * as svc from "../services/experimentService.js";
import { ok, paginated } from "../utils/http.js";

export const list = async (req, res) => {
  const { items, total } = await svc.listExperiments(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};
export const get = async (req, res) => ok(res, await svc.getExperiment(req.valid.params.id));
export const create = async (req, res) => ok(res, await svc.createExperiment(req.valid.body, req), { status: 201 });
export const update = async (req, res) => ok(res, await svc.updateExperiment(req.valid.params.id, req.valid.body));
export const start = async (req, res) => ok(res, await svc.startExperiment(req.valid.params.id, req));
export const complete = async (req, res) => ok(res, await svc.completeExperiment(req.valid.params.id, req.valid.body, req));
export const cancel = async (req, res) => ok(res, await svc.cancelExperiment(req.valid.params.id, req));
