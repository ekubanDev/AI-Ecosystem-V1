import { z } from "zod";
import { BUSINESS_MODEL_TYPES, CONFIDENCE, EVIDENCE_TYPES, SOURCED_EVIDENCE_TYPES } from "../models/constants.js";
import { BaseAgent } from "./baseAgent.js";
import { SYSTEM_PROMPT, buildPrompt, capConfidence, commonOutput, enumCI, refList, strList } from "./agentUtils.js";

const inputSchema = z.object({
  opportunityId: z.string(),
  opportunity: z.object({ name: z.string() }).passthrough(),
  evidence: z.array(z.object({ claim: z.string(), evidenceType: z.string().optional(), area: z.string().optional() }).passthrough()).max(200).default([]),
  competitors: z.array(z.object({ name: z.string() }).passthrough()).max(20).default([]),
});

const FIELDS = ["customer", "problem", "valueProposition", "product", "acquisition", "conversion", "pricing", "delivery", "retention", "upsell", "referral"];

const field = z.object({ value: z.string().trim().min(1).max(1500), evidenceType: enumCI(EVIDENCE_TYPES), evidenceRefs: refList });
const llmSchema = z.object({
  ...Object.fromEntries(FIELDS.map((f) => [f, field])),
  revenueModel: enumCI(BUSINESS_MODEL_TYPES).catch("OTHER"),
  operationalDependencies: strList(),
  technologyDependencies: strList(),
  confidence: enumCI(CONFIDENCE),
  uncertainties: strList(),
  assumptions: strList(),
});

const outField = z.object({ value: z.string(), evidenceType: z.enum(EVIDENCE_TYPES) });
const outputSchema = z.object({
  ...commonOutput,
  businessModel: z.object({
    ...Object.fromEntries(FIELDS.map((f) => [f, outField])),
    revenueModel: z.enum(BUSINESS_MODEL_TYPES),
    operationalDependencies: z.array(z.string()),
    technologyDependencies: z.array(z.string()),
  }),
});

const ROLE = "You are the Business Model Analyst. You reconstruct the observable business model (Business DNA) of an opportunity using only the supplied evidence.";

export class BusinessModelAgent extends BaseAgent {
  constructor() {
    super({
      agentType: "BUSINESS_MODEL", name: "Business Model Agent", version: "0.1.0",
      description: "Transforms research into a Business DNA record, labelling each field's evidence type.",
      objective: "Reconstruct the business model without presenting inference as fact.",
      inputSchema, outputSchema,
      permissions: { read: ["opportunities", "research"], write: ["businessModel"], external: [] },
    });
  }

  async execute(input, ctx) {
    const numbered = input.evidence.map((e, i) => ({ ref: i + 1, claim: e.claim, evidenceType: e.evidenceType, area: e.area }));
    const { data } = await ctx.ai.generateJSON({
      label: this.name, system: SYSTEM_PROMPT, schema: llmSchema, signal: ctx.signal,
      prompt: buildPrompt({
        role: ROLE,
        objective: "Fill in each Business DNA field. For each field give the value, its evidenceType, and evidenceRefs (numbers from the evidence list) supporting it. Use revenueModel from: " + BUSINESS_MODEL_TYPES.join(", ") + ".",
        knownData: { opportunity: input.opportunity, competitors: input.competitors, evidence: numbered },
        constraints: [
          "VERIFIED / SUPPORTED require at least one evidenceRef; otherwise label INFERRED, ASSUMED or UNKNOWN.",
          "If a field is not known, say so in the value and use UNKNOWN. Do not invent pricing, customers or revenue.",
        ],
      }),
    });

    const valid = new Set(numbered.map((n) => n.ref));
    let downgraded = 0;
    const businessModel = {};
    for (const f of FIELDS) {
      let { value, evidenceType, evidenceRefs } = data[f];
      if (SOURCED_EVIDENCE_TYPES.includes(evidenceType) && !evidenceRefs.some((r) => valid.has(r))) {
        evidenceType = "INFERRED";
        downgraded++;
      }
      businessModel[f] = { value, evidenceType };
    }
    businessModel.revenueModel = data.revenueModel;
    businessModel.operationalDependencies = data.operationalDependencies;
    businessModel.technologyDependencies = data.technologyDependencies;

    const uncertainties = [...data.uncertainties];
    if (downgraded) uncertainties.push(`${downgraded} field(s) claimed evidence support without citing any evidence and were downgraded to INFERRED.`);
    if (!input.evidence.length) uncertainties.push("No evidence was available; every field is inference.");
    const anySourced = FIELDS.some((f) => SOURCED_EVIDENCE_TYPES.includes(businessModel[f].evidenceType));
    const confidence = anySourced ? capConfidence(data.confidence, "MEDIUM") : capConfidence(data.confidence, "LOW");

    return {
      status: "COMPLETED", confidence,
      findings: FIELDS.map((f) => ({ statement: `${f}: ${businessModel[f].value}`, evidenceType: businessModel[f].evidenceType, confidence, sourceIds: [] })),
      sources: [], assumptions: data.assumptions, uncertainties, recommendations: [], businessModel,
    };
  }
}
