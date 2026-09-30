import { z } from "zod";
import {
  BUSINESS_MODEL_TYPES, CONFIDENCE, EVIDENCE_TYPES, LEVEL3, OPPORTUNITY_STATUSES, SEVERITY, STRENGTH,
} from "../models/constants.js";
import { nonEmpty, objectId, optionalStr, paginationQuery } from "./common.js";

const list = (item, max = 50) => z.array(item).max(max);
const s = (max = 500) => z.string().trim().max(max);

const fields = {
  name: nonEmpty(200),
  category: optionalStr(100),
  description: optionalStr(5000),
  targetCustomer: z.object({ segment: optionalStr(300), businessType: optionalStr(300), geography: optionalStr(200) }).partial(),
  problem: optionalStr(),
  proposedSolution: optionalStr(),
  businessModel: z.object({ type: z.enum(BUSINESS_MODEL_TYPES).optional(), revenueMechanism: optionalStr(500) }),
  pricing: z
    .object({
      minimum: z.number().min(0).optional(),
      maximum: z.number().min(0).optional(),
      currency: z.string().trim().max(8).optional(),
      pricingEvidence: optionalStr(),
    })
    .refine((p) => p.minimum == null || p.maximum == null || p.minimum <= p.maximum, "minimum must not exceed maximum"),
  acquisitionChannels: list(s(200)),
  retentionMechanism: optionalStr(1000),
  demandSignals: list(
    z.object({ source: optionalStr(300), observation: nonEmpty(1000), evidence: optionalStr(2000), strength: z.enum(STRENGTH).default("UNKNOWN") })
  ),
  differentiation: list(z.object({ idea: nonEmpty(500), rationale: optionalStr(2000), geography: optionalStr(200) })),
  complexity: z.object({ technical: z.enum(LEVEL3).optional(), operational: z.enum(LEVEL3).optional(), capital: z.enum(LEVEL3).optional() }),
  risks: list(z.object({ category: optionalStr(100), description: nonEmpty(1000), severity: z.enum(SEVERITY) })),
  hypotheses: list(z.object({ statement: nonEmpty(1000), status: z.enum(["UNTESTED", "SUPPORTED", "REFUTED", "INCONCLUSIVE"]).default("UNTESTED") })),
  validationPlan: z.object({
    objective: optionalStr(1000), method: optionalStr(1000), budget: z.number().min(0).optional(), successCriteria: optionalStr(1000),
  }),
  evidence: list(
    z.object({
      claim: nonEmpty(2000),
      sourceId: objectId.optional(),
      evidenceType: z.enum(EVIDENCE_TYPES).default("UNKNOWN"),
      confidence: z.enum(CONFIDENCE).default("UNKNOWN"),
    }),
    200
  ),
};

export const createOpportunity = z.object(fields).partial().required({ name: true }).strict();
// Status is never client-editable: transitions go through approve / reject / pause / resume / analyze / experiments.
export const updateOpportunity = z.object(fields).partial().strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const listOpportunities = paginationQuery.extend({
  sortBy: z.enum(["createdAt", "updatedAt", "name", "status", "category"]).default("createdAt"),
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  category: z.string().trim().max(100).optional(),
  geography: z.string().trim().max(200).optional(),
  businessModelType: z.enum(BUSINESS_MODEL_TYPES).optional(),
  createdBy: objectId.optional(),
}).strict();

export const decisionBody = z.object({ note: z.string().trim().max(2000).optional() }).strict();
export const rejectBody = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
