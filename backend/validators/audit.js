import { z } from "zod";
import { AUDIT_ACTIONS } from "../models/constants.js";
import { objectId, paginationQuery } from "./common.js";

// Resource types the audit log writes today; whitelisted so the filter can't be used to probe arbitrary values.
export const AUDIT_RESOURCE_TYPES = ["User", "Opportunity", "Experiment", "AgentTask", "AgentRun", "DiscoveryRun"];

const day = z.coerce.date();

export const listAudit = paginationQuery
  .extend({
    sortBy: z.enum(["createdAt"]).default("createdAt"),
    action: z.enum(AUDIT_ACTIONS).optional(),
    resourceType: z.enum(AUDIT_RESOURCE_TYPES).optional(),
    resourceId: objectId.optional(),
    actorId: objectId.optional(),
    actorType: z.enum(["USER", "AGENT", "SYSTEM"]).optional(),
    from: day.optional(),
    to: day.optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "`from` must not be after `to`", path: ["from"] });
