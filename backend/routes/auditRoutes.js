import { Router } from "express";
import * as c from "../controllers/auditController.js";
import { protect, requireCapability } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { listAudit } from "../validators/audit.js";

const r = Router();
r.use(protect, requireCapability("audit:read"));
r.get("/", validate({ query: listAudit }), c.list);
r.get("/facets", c.facets);
export default r;
