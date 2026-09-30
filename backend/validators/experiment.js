import { z } from "zod";
import { EXPERIMENT_STATUSES } from "../models/constants.js";
import { nonEmpty, objectId, optionalStr, paginationQuery } from "./common.js";

const metric = z.object({
  name: nonEmpty(100),
  target: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  actual: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
});

const base = {
  name: nonEmpty(200),
  hypothesis: nonEmpty(2000),
  objective: optionalStr(2000),
  method: optionalStr(2000),
  targetCustomer: optionalStr(500),
  budget: z.number().min(0),
  currency: z.string().trim().max(8).optional(),
  metrics: z.array(metric).max(30).optional(),
  successCriteria: optionalStr(2000),
};

export const createExperiment = z
  .object({ opportunityId: objectId, ...base, budget: base.budget.default(0) })
  .strict();

export const updateExperiment = z
  .object({
    ...base,
    // Limited manual status moves: DRAFT <-> READY. RUNNING/COMPLETED/CANCELLED have dedicated endpoints.
    status: z.enum(["DRAFT", "READY"]).optional(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const completeExperiment = z
  .object({
    results: nonEmpty(5000),
    conclusion: nonEmpty(5000),
    nextAction: nonEmpty(2000),
    metrics: z.array(metric).max(30).optional(),
  })
  .strict();

export const listExperiments = paginationQuery.extend({
  sortBy: z.enum(["createdAt", "updatedAt", "name", "status"]).default("createdAt"),
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  opportunityId: objectId.optional(),
}).strict();
