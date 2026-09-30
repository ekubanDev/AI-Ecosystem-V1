import * as svc from "../services/userService.js";
import { ok, paginated } from "../utils/http.js";

export const list = async (req, res) => {
  const { items, total } = await svc.listUsers(req.valid.query);
  return paginated(res, items, { page: req.valid.query.page, limit: req.valid.query.limit, total });
};
export const update = async (req, res) => ok(res, await svc.updateUser(req.valid.params.id, req.valid.body, req));
