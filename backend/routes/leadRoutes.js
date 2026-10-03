import { Router } from "express";
import * as c from "../controllers/landingController.js";
import { protect, requireCapability } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam } from "../validators/common.js";
import * as v from "../validators/landing.js";

const r = Router();
r.use(protect);
r.get("/", requireCapability("leads:read"), validate({ query: v.listLeads }), c.listLeads);
r.patch("/:id", requireCapability("leads:write"), validate({ params: idParam, body: v.updateLead }), c.updateLead);
r.delete("/:id", requireCapability("leads:write"), validate({ params: idParam }), c.deleteLead);
export default r;
