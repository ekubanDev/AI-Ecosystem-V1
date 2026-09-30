import { z } from "zod";
import { ROLES } from "../models/constants.js";
import { paginationQuery } from "./common.js";

export const updateUser = z
  .object({ role: z.enum(ROLES).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const listUsers = paginationQuery.extend({
  sortBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
  role: z.enum(ROLES).optional(),
}).strict();
