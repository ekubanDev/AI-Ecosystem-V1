import { Router } from "express";
import * as c from "../controllers/experimentController.js";
import { protect, requireCapability } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { idParam } from "../validators/common.js";
import * as v from "../validators/experiment.js";

const r = Router();
r.use(protect);
r.get("/", requireCapability("experiments:read"), validate({ query: v.listExperiments }), c.list);
r.post("/", requireCapability("experiments:write"), validate({ body: v.createExperiment }), c.create);
r.get("/:id", requireCapability("experiments:read"), validate({ params: idParam }), c.get);
r.patch("/:id", requireCapability("experiments:write"), validate({ params: idParam, body: v.updateExperiment }), c.update);
r.post("/:id/start", requireCapability("experiments:write"), validate({ params: idParam }), idempotent, c.start);
r.post("/:id/complete", requireCapability("experiments:write"), validate({ params: idParam, body: v.completeExperiment }), c.complete);
r.post("/:id/cancel", requireCapability("experiments:write"), validate({ params: idParam }), c.cancel);
export default r;
