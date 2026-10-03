import { z } from "zod";
import { LEAD_STATUSES } from "../models/constants.js";
import { email, nonEmpty, objectId, paginationQuery } from "./common.js";

export const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/, "Invalid page") });

const text = (max) => z.string().trim().max(max).optional();

export const updateLanding = z
  .object({
    enabled: z.boolean(),
    headline: text(120),
    subheadline: text(300),
    bullets: z.array(nonEmpty(160)).max(6).optional(),
    ctaLabel: text(40),
  })
  .strict()
  .refine((v) => !v.enabled || Boolean(v.headline), { message: "A headline is required to publish the page", path: ["headline"] });

export const submitLead = z
  .object({
    name: nonEmpty(120),
    email,
    phone: text(40),
    company: text(150),
    sector: text(100),
    message: text(1000),
    source: text(100),
    consent: z.literal(true, { error: "Consent is required to submit your details" }),
    website: z.string().max(200).optional(), // honeypot: real people never see or fill this field
  })
  .strict();

export const listLeads = paginationQuery.extend({
  opportunityId: objectId.optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});

export const updateLead = z
  .object({ status: z.enum(LEAD_STATUSES).optional(), notes: z.string().trim().max(2000).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
