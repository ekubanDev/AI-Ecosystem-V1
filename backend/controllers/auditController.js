import { AUDIT_ACTIONS } from "../models/constants.js";
import { listAuditEvents } from "../services/auditQueryService.js";
import { ok, paginated } from "../utils/http.js";
import { AUDIT_RESOURCE_TYPES } from "../validators/audit.js";

export const list = async (req, res) => {
  const { items, total } = await listAuditEvents(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};

/** Filter vocabulary for clients, so UIs don't hard-code (and drift from) the server's action list. */
export const facets = async (_req, res) => ok(res, { actions: AUDIT_ACTIONS, resourceTypes: AUDIT_RESOURCE_TYPES });
