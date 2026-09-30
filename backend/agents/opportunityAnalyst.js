import { z } from "zod";
import { CONFIDENCE, LEVEL3, SEVERITY, SOURCED_EVIDENCE_TYPES } from "../models/constants.js";
import { BaseAgent } from "./baseAgent.js";
import { SYSTEM_PROMPT, buildPrompt, capConfidence, commonOutput, enumCI, strList } from "./agentUtils.js";

const inputSchema = z.object({
  opportunityId: z.string(),
  opportunity: z.object({ name: z.string() }).passthrough(),
  evidence: z.array(z.object({ claim: z.string(), evidenceType: z.string().optional() }).passthrough()).max(200).default([]),
  businessModel: z.record(z.string(), z.unknown()).nullish(),
  competitors: z.array(z.object({ name: z.string() }).passthrough()).max(20).default([]),
});

const conf = enumCI(CONFIDENCE);
const rated = (values) => z.object({ value: enumCI(values), confidence: conf });
const DEMAND = ["STRONG", "MODERATE", "WEAK", "UNKNOWN"];
const COMPETITION = ["LOW", "MODERATE", "HIGH", "UNKNOWN"];
const MONETIZATION = ["LIKELY", "POSSIBLE", "UNLIKELY", "UNKNOWN"];
const RECURRING = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const CAPITAL = ["LOW", "LOW_TO_MEDIUM", "MEDIUM", "HIGH"];

const num = z.number().nonnegative().nullish();
const llmSchema = z.object({
  assessment: z.object({
    demand: rated(DEMAND),
    competition: rated(COMPETITION),
    monetization: rated(MONETIZATION),
    recurringRevenuePotential: rated(RECURRING),
    acquisitionDifficulty: enumCI(LEVEL3),
    technicalComplexity: enumCI(LEVEL3),
    operationalComplexity: enumCI(LEVEL3),
    capitalRequirement: enumCI(CAPITAL),
    regulatoryConsiderations: strList(),
    localization: z.object({ summary: z.string().trim().max(2000), confidence: conf }),
    differentiationOpportunities: z.array(z.object({ idea: z.string().min(1), rationale: z.string().default(""), geography: z.string().default("") })).max(10).default([]),
    risks: z.array(z.object({ category: z.string().default("general"), description: z.string().min(1), severity: enumCI(SEVERITY) })).max(15).default([]),
    economics: z
      .object({ estimatedCAC: num, estimatedLTV: num, estimatedARPU: num, estimatedMargin: num, currency: z.string().max(8).nullish(), confidence: conf, basis: z.string().trim().max(2000).nullish() })
      .nullish(),
    hypotheses: strList(10),
    validationRecommendation: z.object({
      objective: z.string().min(1), method: z.string().min(1), budget: num, successCriteria: z.string().min(1),
    }),
  }),
  uncertainties: strList(),
  assumptions: strList(),
});

const ratedOut = (values) => z.object({ value: z.enum(values), confidence: z.enum(CONFIDENCE) });
const outputSchema = z.object({
  ...commonOutput,
  assessment: z.object({
    demand: ratedOut(DEMAND), competition: ratedOut(COMPETITION), monetization: ratedOut(MONETIZATION),
    recurringRevenuePotential: ratedOut(RECURRING),
    acquisitionDifficulty: z.enum(LEVEL3), technicalComplexity: z.enum(LEVEL3), operationalComplexity: z.enum(LEVEL3),
    capitalRequirement: z.enum(CAPITAL),
    regulatoryConsiderations: z.array(z.string()),
    localization: z.object({ summary: z.string(), confidence: z.enum(CONFIDENCE) }),
    differentiationOpportunities: z.array(z.object({ idea: z.string(), rationale: z.string(), geography: z.string() })),
    risks: z.array(z.object({ category: z.string(), description: z.string(), severity: z.enum(SEVERITY) })),
    economics: z
      .object({
        estimatedCAC: z.number().nullable(), estimatedLTV: z.number().nullable(), estimatedARPU: z.number().nullable(), estimatedMargin: z.number().nullable(),
        currency: z.string().nullable(), confidence: z.enum(CONFIDENCE), basis: z.string(),
      })
      .nullable(),
    hypotheses: z.array(z.string()),
    validationRecommendation: z.object({ objective: z.string(), method: z.string(), budget: z.number().nullable(), successCriteria: z.string() }),
  }),
});

const ROLE = "You are the Opportunity Analyst. You evaluate one opportunity across demand, competition, monetization, recurring-revenue potential, acquisition, complexity, capital, localization and differentiation, and recommend the cheapest credible validation experiment. You do not make the investment decision.";

export class OpportunityAnalyst extends BaseAgent {
  constructor() {
    super({
      agentType: "OPPORTUNITY_ANALYST", name: "Opportunity Analyst", version: "0.1.0",
      description: "Evaluates an opportunity from the gathered evidence and recommends a validation experiment.",
      objective: "Produce an evidence-aware assessment; never present uncertain estimates as facts.",
      inputSchema, outputSchema,
      permissions: { read: ["opportunities", "research", "businessModel", "competitors"], write: ["analysis"], external: [] },
    });
  }

  async execute(input, ctx) {
    const { data } = await ctx.ai.generateJSON({
      label: this.name, system: SYSTEM_PROMPT, schema: llmSchema, signal: ctx.signal,
      prompt: buildPrompt({
        role: ROLE,
        objective: `Assess the opportunity. capitalRequirement is one of ${CAPITAL.join(", ")}. Give a confidence for each rating. Recommend a small validation experiment (objective, method, budget, successCriteria) that would generate real customer evidence.`,
        knownData: {
          opportunity: input.opportunity, businessModel: input.businessModel, competitors: input.competitors,
          evidence: input.evidence.slice(0, 80).map((e) => ({ claim: e.claim, evidenceType: e.evidenceType })),
        },
        constraints: [
          "Only fill `economics` numbers if you can explain their basis; otherwise set economics to null. They are estimates, not facts.",
          "Do not claim the business will be profitable. Say what is unknown.",
          "Prefer UNKNOWN over guessing when evidence is thin.",
        ],
      }),
    });

    const a = data.assessment;
    // With no sourced evidence behind the analysis, no rating may claim more than LOW confidence.
    const sourcedCount = input.evidence.filter((e) => SOURCED_EVIDENCE_TYPES.includes(e.evidenceType)).length;
    const maxConf = sourcedCount === 0 ? "LOW" : sourcedCount < 3 ? "MEDIUM" : "HIGH";
    const cap = (r) => ({ value: r.value, confidence: capConfidence(r.confidence, maxConf) });

    const uncertainties = [...data.uncertainties];
    if (sourcedCount === 0) uncertainties.push("No sourced (VERIFIED/SUPPORTED) evidence supports this analysis; all ratings are capped at LOW confidence.");

    let economics = null;
    if (a.economics && a.economics.basis) {
      economics = {
        estimatedCAC: a.economics.estimatedCAC ?? null, estimatedLTV: a.economics.estimatedLTV ?? null, estimatedARPU: a.economics.estimatedARPU ?? null,
        estimatedMargin: a.economics.estimatedMargin ?? null, currency: a.economics.currency ?? null,
        confidence: capConfidence(a.economics.confidence, sourcedCount === 0 ? "LOW" : "MEDIUM"), // estimates never exceed MEDIUM
        basis: a.economics.basis,
      };
    } else if (a.economics) uncertainties.push("Economic estimates were discarded because no basis was given.");

    const assessment = {
      demand: cap(a.demand), competition: cap(a.competition), monetization: cap(a.monetization), recurringRevenuePotential: cap(a.recurringRevenuePotential),
      acquisitionDifficulty: a.acquisitionDifficulty, technicalComplexity: a.technicalComplexity, operationalComplexity: a.operationalComplexity,
      capitalRequirement: a.capitalRequirement, regulatoryConsiderations: a.regulatoryConsiderations,
      localization: { summary: a.localization.summary, confidence: capConfidence(a.localization.confidence, maxConf) },
      differentiationOpportunities: a.differentiationOpportunities, risks: a.risks, economics, hypotheses: a.hypotheses,
      validationRecommendation: { ...a.validationRecommendation, budget: a.validationRecommendation.budget ?? null },
    };

    return {
      status: "COMPLETED",
      confidence: [assessment.demand, assessment.competition, assessment.monetization].map((r) => r.confidence).reduce((x, y) => capConfidence(x, y), "HIGH"),
      findings: [
        { statement: `Demand: ${assessment.demand.value}`, evidenceType: "INFERRED", confidence: assessment.demand.confidence, sourceIds: [] },
        { statement: `Competition: ${assessment.competition.value}`, evidenceType: "INFERRED", confidence: assessment.competition.confidence, sourceIds: [] },
        { statement: `Monetization: ${assessment.monetization.value}`, evidenceType: "INFERRED", confidence: assessment.monetization.confidence, sourceIds: [] },
      ],
      sources: [], assumptions: data.assumptions, uncertainties,
      recommendations: [`Validate first: ${assessment.validationRecommendation.objective}`],
      assessment,
    };
  }
}
