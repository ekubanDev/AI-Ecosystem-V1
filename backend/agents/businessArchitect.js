import { z } from "zod";
import { CONFIDENCE, EVIDENCE_TYPES, SOURCED_EVIDENCE_TYPES } from "../models/constants.js";
import { BaseAgent } from "./baseAgent.js";
import { SYSTEM_PROMPT, buildPrompt, capConfidence, commonOutput, enumCI, strList } from "./agentUtils.js";

const inputSchema = z.object({
  opportunityId: z.string(),
  opportunity: z.object({ name: z.string() }).passthrough(),
  evidence: z.array(z.object({ claim: z.string(), evidenceType: z.string().optional() }).passthrough()).max(200).default([]),
  businessModel: z.record(z.string(), z.unknown()).nullish(),
  competitors: z.array(z.object({ name: z.string() }).passthrough()).max(20).default([]),
  analysis: z.record(z.string(), z.unknown()).nullish(),
  experiments: z.array(z.object({ name: z.string() }).passthrough()).max(20).default([]),
});

const text = (max, min = 1) => z.string().trim().min(min).max(max);
const llmSchema = z.object({
  positioning: text(1500),
  brandOptions: z.array(z.object({ name: text(80), rationale: text(500, 0).default("") })).max(10).default([]),
  offer: z.object({ whatYouSell: text(1500), howDelivered: text(1500, 0).default("") }),
  pricingHypotheses: z
    .array(z.object({
      tier: text(100), price: z.number().nonnegative().nullish(), currency: z.string().trim().max(8).nullish(),
      unit: text(60, 0).default(""), basis: text(600, 0).default(""), evidenceType: enumCI(EVIDENCE_TYPES).catch("ASSUMED"),
    }))
    .max(6).default([]),
  mvpScope: z.object({ mustHave: strList(10), niceToHave: strList(10), notNow: strList(10) }),
  manualFirstPlan: strList(12),
  launchChecklist: z.array(z.object({ item: text(300), requiresHumanApproval: z.boolean().default(false) })).max(15).default([]),
  validationGates: strList(10),
  localizationNotes: strList(10),
  risksAndMitigations: z.array(z.object({ risk: text(400), mitigation: text(600, 0).default("") })).max(10).default([]),
  assumptions: strList(),
  uncertainties: strList(),
  confidence: enumCI(CONFIDENCE),
});

const outputSchema = z.object({
  ...commonOutput,
  blueprint: z.object({
    positioning: z.string(),
    brandOptions: z.array(z.object({ name: z.string(), rationale: z.string() })),
    offer: z.object({ whatYouSell: z.string(), howDelivered: z.string() }),
    pricingHypotheses: z.array(z.object({
      tier: z.string(), price: z.number().nullable(), currency: z.string().nullable(), unit: z.string(), basis: z.string(), evidenceType: z.enum(EVIDENCE_TYPES),
    })),
    mvpScope: z.object({ mustHave: z.array(z.string()), niceToHave: z.array(z.string()), notNow: z.array(z.string()) }),
    manualFirstPlan: z.array(z.string()),
    launchChecklist: z.array(z.object({ item: z.string(), requiresHumanApproval: z.boolean() })),
    validationGates: z.array(z.string()),
    localizationNotes: z.array(z.string()),
    risksAndMitigations: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
  }),
});

// Blueprint §21: these always need a human decision, whatever the model says.
const NEEDS_HUMAN = /\b(paid ads?|advertis\w*|ad spend|legal|contract|incorporat\w*|register(ed)? (the )?(business|company)|licen[sc]e\w*|regulat\w*|payment|payments|mobile money|momo|bank|refund|tax|spend|budget|hire|hiring|launch)\b/i;

// Plan steps are prose, so "payment" alone (as in "log responses: no reply, interested, payment") must not trigger; only actions do.
const NEEDS_HUMAN_STEP = /\b(paid ads?|advertis\w*|ad spend|legal|contract|incorporat\w*|licen[sc]e\w*|regulat\w*|(set up|collect|accept|process|take) (online )?payments?|payment (gateway|method|link|collection|processor)|mobile money|momo|bank account|spend|hire|hiring|launch)\b/i;

const ROLE = "You are the Business Architect. You turn one approved opportunity into a practical business blueprint: positioning, offer, brand ideas, pricing hypotheses, MVP scope, a manual-first plan and a launch checklist. You are planning, not proving: nothing you write is evidence that the business will work.";

export class BusinessArchitect extends BaseAgent {
  constructor() {
    super({
      agentType: "BUSINESS_ARCHITECT", name: "Business Architect", version: "0.1.0",
      description: "Drafts a business blueprint (positioning, offer, pricing hypotheses, MVP scope, manual-first plan, launch checklist) for an approved opportunity.",
      objective: "Produce a plan to test and build the business cheaply, labelled as hypotheses, never as proven fact.",
      inputSchema, outputSchema,
      permissions: { read: ["opportunities", "research", "businessModel", "competitors", "experiments"], write: ["blueprint"], external: [] },
    });
  }

  async execute(input, ctx) {
    const { data } = await ctx.ai.generateJSON({
      label: this.name, system: SYSTEM_PROMPT, schema: llmSchema, signal: ctx.signal,
      prompt: buildPrompt({
        role: ROLE,
        objective: "Draft the blueprint. If an experiment is already planned or running (see `experiments`), align the manual-first plan and validation gates with that experiment's method and success criteria instead of inventing a different test or new target numbers. Start manual (Blueprint ladder: manual service → AI-assisted → productized → automated → SaaS): the manualFirstPlan should deliver value to the first customers without building software. Give 3 to 5 brand name ideas. Give pricing as hypotheses: a price needs a `basis` (for example a competitor price from the data below); if you have no basis, leave price null. validationGates are things that must be true before building software. Mark launchChecklist items that need the owner's decision (paid advertising, legal or regulatory steps, payments, spending, hiring) with requiresHumanApproval.",
        knownData: {
          opportunity: input.opportunity, businessModel: input.businessModel, analysis: input.analysis, competitors: input.competitors, experiments: input.experiments,
          evidence: input.evidence.slice(0, 80).map((e) => ({ claim: e.claim, evidenceType: e.evidenceType })),
        },
        constraints: [
          "This is a plan, not evidence. Do not invent customers, revenue, market sizes, traction or competitor facts.",
          "Brand names are ideas only: do not copy or imitate a competitor's name, brand or trademark.",
          "Use only facts present in the data above for anything about competitors or prices; everything else is a hypothesis.",
          "Consider the target geography's currency, payment methods and regulation in localizationNotes, and say these need verifying.",
        ],
      }),
    });

    const uncertainties = [...data.uncertainties, "Brand names are ideas only: availability of the names, domains and trademarks has NOT been checked."];
    const assumptions = [...data.assumptions];

    // No external sources here, so nothing the model says can be VERIFIED/SUPPORTED; a price without a basis is dropped.
    let unbased = 0;
    let relabelled = 0;
    const pricingHypotheses = data.pricingHypotheses.map((p) => {
      let evidenceType = p.evidenceType;
      if (SOURCED_EVIDENCE_TYPES.includes(evidenceType)) { evidenceType = "INFERRED"; relabelled++; }
      const hasBasis = Boolean(p.basis);
      if (!hasBasis && p.price != null) unbased++;
      return {
        tier: p.tier, price: hasBasis ? (p.price ?? null) : null, currency: hasBasis && p.price != null ? (p.currency?.toUpperCase() ?? null) : null,
        unit: p.unit, basis: p.basis || "No basis stated: price left blank", evidenceType,
      };
    });
    if (unbased) uncertainties.push(`${unbased} price(s) were proposed without a stated basis and were removed.`);
    if (relabelled) uncertainties.push(`${relabelled} pricing hypothesis(es) claimed source-backed evidence that this agent cannot have; relabelled INFERRED.`);

    let forced = 0;
    const launchChecklist = data.launchChecklist.map((c) => {
      const needs = c.requiresHumanApproval || NEEDS_HUMAN.test(c.item);
      if (needs && !c.requiresHumanApproval) forced++;
      return { item: c.item, requiresHumanApproval: needs };
    });
    if (forced) assumptions.push(`${forced} checklist item(s) were flagged as needing your approval (spending, legal, payments or launch).`);
    // The same rule applies to steps buried in the manual-first plan (live output put "run a paid ad campaign" there, outside the checklist).
    for (const step of data.manualFirstPlan.filter((s) => NEEDS_HUMAN_STEP.test(s))) {
      assumptions.push(`Needs your approval before it happens (spending, legal, payments or launch): "${step}"`);
    }

    const sourced = input.evidence.filter((e) => SOURCED_EVIDENCE_TYPES.includes(e.evidenceType)).length;
    const completed = input.experiments.filter((e) => e.status === "COMPLETED").length;
    if (!completed) uncertainties.push("No validation experiment has been completed for this opportunity: demand is unproven, so treat this blueprint as a plan to test, not a proven business.");
    const confidence = capConfidence(data.confidence, sourced === 0 ? "LOW" : "MEDIUM");

    const blueprint = {
      positioning: data.positioning,
      brandOptions: data.brandOptions.slice(0, 5).map((b) => ({ name: b.name, rationale: b.rationale })),
      offer: data.offer, pricingHypotheses, mvpScope: data.mvpScope, manualFirstPlan: data.manualFirstPlan,
      launchChecklist, validationGates: data.validationGates, localizationNotes: data.localizationNotes, risksAndMitigations: data.risksAndMitigations,
    };
    return {
      status: "COMPLETED", confidence,
      findings: [
        { statement: `Positioning: ${blueprint.positioning}`, evidenceType: "INFERRED", confidence: capConfidence(confidence, "MEDIUM"), sourceIds: [] },
        ...pricingHypotheses.map((p) => ({ statement: `Pricing hypothesis, ${p.tier}: ${p.price ?? "no price"} ${p.currency ?? ""} ${p.unit}`.trim(), evidenceType: p.evidenceType, confidence: "LOW", sourceIds: [] })),
      ],
      sources: [], assumptions, uncertainties, recommendations: blueprint.validationGates.slice(0, 3), blueprint,
    };
  }
}
