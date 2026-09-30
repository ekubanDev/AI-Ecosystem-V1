import { Router } from "express";
import * as c from "../controllers/userController.js";
import { protect, requireCapability } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam } from "../validators/common.js";
import * as v from "../validators/users.js";

const r = Router();
r.use(protect, requireCapability("users:manage"));
r.get("/", validate({ query: v.listUsers }), c.list);
r.patch("/:id", validate({ params: idParam, body: v.updateUser }), c.update);
export default r;
