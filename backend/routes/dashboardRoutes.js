import { Router } from "express";
import * as c from "../controllers/dashboardController.js";
import { protect, requireCapability } from "../middleware/auth.js";

const r = Router();
r.use(protect, requireCapability("dashboard:read"));
r.get("/summary", c.summary);
r.get("/opportunities", c.opportunities);
r.get("/agent-activity", c.agentActivity);
r.get("/experiments", c.experiments);
export default r;
