import { z } from "zod";
import { AGENT_TYPES, RUN_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "../models/constants.js";
import { objectId, paginationQuery } from "./common.js";

// Accepts OPPORTUNITY_SCOUT or opportunity-scout.
export const agentTypeParam = z.object({
  agentType: z.string().transform((v) => v.toUpperCase().replace(/-/g, "_")).pipe(z.enum(AGENT_TYPES)),
});

export const runAgent = z
  .object({
    objective: z.string().trim().max(1000).optional(),
    input: z.record(z.string(), z.unknown()).default({}),
    priority: z.enum(TASK_PRIORITIES).default("NORMAL"),
  })
  .strict();

export const listRuns = paginationQuery.extend({
  sortBy: z.enum(["createdAt", "startedAt", "durationMs"]).default("createdAt"),
  agentType: z.enum(AGENT_TYPES).optional(),
  status: z.enum(RUN_STATUSES).optional(),
  taskId: objectId.optional(),
}).strict();

export const listTasks = paginationQuery.extend({
  sortBy: z.enum(["createdAt", "startedAt", "priority"]).default("createdAt"),
  agentType: z.enum(AGENT_TYPES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  workflowId: z.string().max(100).optional(),
  opportunityId: objectId.optional(),
}).strict();
