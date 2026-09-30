import { z } from "zod";
import { DISCOVERY_RUN_STATUSES } from "../models/constants.js";
import { paginationQuery } from "./common.js";

const str = (max) => z.string().trim().min(1).max(max);
const strList = z.array(str(100)).max(20);

/** Accepts the Database & API Specification §18 contract, plus the optional geography/categories lists from the Technical Specification §27. */
export const discoveryRequest = (maxCount) =>
  z
    .object({
      objective: str(1000).optional(),
      count: z.number().int().min(1).max(maxCount).default(20),
      market: str(200),
      geography: strList.optional(),
      categories: strList.optional(),
      customerType: str(50).optional(),
      revenuePreference: strList.optional(),
      constraints: z.object({ capital: str(100).optional(), preference: str(500).optional() }).strict().optional(),
    })
    .strict();

export const listDiscoveryRuns = paginationQuery.extend({
  sortBy: z.enum(["createdAt", "startedAt"]).default("createdAt"),
  status: z.enum(DISCOVERY_RUN_STATUSES).optional(),
}).strict();
