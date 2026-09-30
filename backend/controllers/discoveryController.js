import { DiscoveryRun } from "../models/index.js";
import { notFound } from "../utils/errors.js";
import { ok, paginated } from "../utils/http.js";
import { buildSort } from "../utils/pagination.js";

const orch = (req) => req.app.locals.container.orchestrator;

export const run = async (req, res) => {
  const r = await orch(req).startDiscovery(req.valid.body, req);
  return ok(res, { runId: String(r._id), status: r.status }, { status: 202 });
};

export const list = async (req, res) => {
  const q = req.valid.query;
  const filter = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    DiscoveryRun.find(filter).sort(buildSort(q.sortBy, q.order, ["createdAt", "startedAt"])).skip((q.page - 1) * q.limit).limit(q.limit),
    DiscoveryRun.countDocuments(filter),
  ]);
  return paginated(res, items, { page: q.page, limit: q.limit, total });
};

export const get = async (req, res) => {
  const r = await DiscoveryRun.findById(req.valid.params.id);
  if (!r) throw notFound("Discovery run");
  return ok(res, await orch(req).describeRun(r));
};

export const cancel = async (req, res) => ok(res, await orch(req).cancelDiscovery(req.valid.params.id, req));
