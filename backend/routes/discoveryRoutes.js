import { Router } from "express";
import * as c from "../controllers/discoveryController.js";
import { protect, requireCapability } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { idParam } from "../validators/common.js";
import * as v from "../validators/discovery.js";

export default function discoveryRoutes(config) {
  const r = Router();
  r.use(protect);
  r.post("/run", requireCapability("agents:run"), validate({ body: v.discoveryRequest(config.DISCOVERY_MAX_COUNT) }), idempotent, c.run);
  r.get("/runs", requireCapability("agents:read"), validate({ query: v.listDiscoveryRuns }), c.list);
  r.get("/runs/:id", requireCapability("agents:read"), validate({ params: idParam }), c.get);
  r.post("/runs/:id/cancel", requireCapability("agents:run"), validate({ params: idParam }), c.cancel);
  return r;
}
