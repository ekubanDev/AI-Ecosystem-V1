import * as svc from "../services/landingService.js";
import { ok, paginated } from "../utils/http.js";

export const getPublic = async (req, res) => ok(res, await svc.getPublicLanding(req.valid.params.slug));
export const submitLead = async (req, res) => ok(res, await svc.submitLead(req.valid.params.slug, req.valid.body, req), { status: 201 });
export const updateLanding = async (req, res) => ok(res, await svc.updateLanding(req.valid.params.id, req.valid.body, req));
export const listLeads = async (req, res) => {
  const { items, total } = await svc.listLeads(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};
export const updateLead = async (req, res) => ok(res, await svc.updateLead(req.valid.params.id, req.valid.body, req));
export const deleteLead = async (req, res) => ok(res, await svc.deleteLead(req.valid.params.id, req));
