import { Router } from "express";
import * as c from "../controllers/agentController.js";
import { protect, requireCapability } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { idParam } from "../validators/common.js";
import * as v from "../validators/agents.js";

const r = Router();
r.use(protect);
r.get("/", requireCapability("agents:read"), c.list);
r.get("/runs", requireCapability("agents:read"), validate({ query: v.listRuns }), c.listRuns);
r.get("/runs/:id", requireCapability("agents:read"), validate({ params: idParam }), c.getRun);
r.get("/tasks", requireCapability("agents:read"), validate({ query: v.listTasks }), c.listTasks);
r.get("/tasks/:id", requireCapability("agents:read"), validate({ params: idParam }), c.getTask);
r.post("/tasks/:id/retry", requireCapability("agents:runDirect"), validate({ params: idParam }), c.retryTask);
r.post("/:agentType/run", requireCapability("agents:runDirect"), validate({ params: v.agentTypeParam, body: v.runAgent }), idempotent, c.run);
export default r;
