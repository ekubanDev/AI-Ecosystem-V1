import { z } from "zod";
import { BaseAgent } from "./baseAgent.js";
import {
  SYSTEM_PROMPT, buildPrompt, commonOutput, llmEvidenceItem, numberDocs, overallConfidence, refList, resolveEvidence, strList, toFindings,
} from "./agentUtils.js";
import { CONFIDENCE, EVIDENCE_TYPES } from "../models/constants.js";

const oppSnapshot = z.object({ name: z.string(), category: z.string().optional(), description: z.string().optional() }).passthrough();

const inputSchema = z.object({
  opportunityId: z.string(),
  opportunity: oppSnapshot,
  researchQuestions: z.array(z.string().trim().min(1)).max(20).default([]),
  existingSources: z.array(z.object({ sourceId: z.string(), url: z.string() })).max(20).default([]),
});

const queriesSchema = z.object({ queries: z.array(z.string().trim().min(3)).min(1).max(6) });

const llmSchema = z.object({
  marketEvidence: z.array(llmEvidenceItem).default([]),
  customerEvidence: z.array(llmEvidenceItem).default([]),
  pricingEvidence: z.array(llmEvidenceItem).default([]),
  competitorEvidence: z.array(llmEvidenceItem).default([]),
  businessModelEvidence: z.array(llmEvidenceItem).default([]),
  competitorLeads: strList(15),
  pricing: z.object({ minimum: z.number().min(0), maximum: z.number().min(0), currency: z.string().max(8), sourceRefs: refList }).nullable().optional(),
  uncertainties: strList(),
});

const evidenceOut = z.array(z.object({ claim: z.string(), evidenceType: z.enum(EVIDENCE_TYPES), confidence: z.enum(CONFIDENCE), sourceIds: z.array(z.string()) }));
const AREAS = ["marketEvidence", "customerEvidence", "pricingEvidence", "competitorEvidence", "businessModelEvidence"];

const outputSchema = z.object({
  ...commonOutput,
  marketEvidence: evidenceOut, customerEvidence: evidenceOut, pricingEvidence: evidenceOut, competitorEvidence: evidenceOut, businessModelEvidence: evidenceOut,
  competitorLeads: z.array(z.string()),
  pricing: z.object({ minimum: z.number(), maximum: z.number(), currency: z.string(), sourceIds: z.array(z.string()) }).nullable(),
});

const ROLE = "You are the Research Agent. You gather and synthesize source-backed evidence about one business opportunity: market, customers, pricing, competitors and business model.";

export class ResearchAgent extends BaseAgent {
  constructor() {
    super({
      agentType: "RESEARCH", name: "Research Agent", version: "0.1.0",
      description: "Collects source-backed market, customer, pricing, competitor and business-model evidence for an opportunity.",
      objective: "Attach cited evidence to an opportunity.",
      inputSchema, outputSchema,
      permissions: { read: ["opportunities", "sources"], write: ["sources", "evidence"], external: ["search", "fetch"] },
    });
  }

  async execute(input, ctx) {
    const { opportunity: opp } = input;
    const oppId = input.opportunityId;
    const raw = [];
    const seen = new Set();
    const add = (d) => {
      if (d && !seen.has(d.url) && raw.length < 10) {
        seen.add(d.url);
        raw.push(d);
      }
    };

    if (ctx.research?.fetchPage) {
      for (const s of input.existingSources.slice(0, 5)) add(await ctx.research.fetchPage(s.url, { opportunityId: oppId, signal: ctx.signal }));
    }
    if (ctx.research?.searchAvailable) {
      const { data } = await ctx.ai.generateJSON({
        label: this.name, system: SYSTEM_PROMPT, schema: queriesSchema, signal: ctx.signal,
        prompt: buildPrompt({
          role: ROLE, objective: "Write up to 5 web search queries to research this opportunity: market demand, target customers' pain, pricing of existing solutions, competitors, and how similar businesses acquire and retain customers.",
          knownData: { opportunity: opp, researchQuestions: input.researchQuestions },
        }),
      });
      for (const q of data.queries.slice(0, 5)) {
        const results = await ctx.research.search(q, { maxResults: 5, opportunityId: oppId, signal: ctx.signal });
        for (const r of results.slice(0, 3)) {
          if (raw.length >= 8 || seen.has(r.url)) continue;
          const page = ctx.research.fetchPage ? await ctx.research.fetchPage(r.url, { opportunityId: oppId, signal: ctx.signal }) : null;
          add(page ?? { url: r.url, title: r.title, text: r.snippet, sourceId: r.sourceId });
        }
      }
    }

    const empty = { marketEvidence: [], customerEvidence: [], pricingEvidence: [], competitorEvidence: [], businessModelEvidence: [], competitorLeads: [], pricing: null };
    if (!raw.length) {
      return {
        status: "COMPLETED", confidence: "UNKNOWN", findings: [], sources: [], assumptions: [], ...empty,
        uncertainties: ["No source material could be gathered (no search provider configured or no page could be fetched); nothing was researched."],
        recommendations: ["Configure SEARCH_PROVIDER or add source URLs to the opportunity, then re-run analysis."],
      };
    }

    const { docs, refMap } = numberDocs(raw);
    const { data } = await ctx.ai.generateJSON({
      label: this.name, system: SYSTEM_PROMPT, schema: llmSchema, signal: ctx.signal,
      prompt: buildPrompt({
        role: ROLE,
        objective: "Extract evidence about the opportunity from the sources. Put each claim in the matching area. List competitor names mentioned in competitorLeads. Only set `pricing` if a source states concrete prices (cite its ref).",
        knownData: { opportunity: opp, researchQuestions: input.researchQuestions }, docs,
        constraints: ["Use only the provided sources.", "List what you could NOT find in uncertainties."],
      }),
    });

    const resolved = {};
    for (const area of AREAS) resolved[area] = resolveEvidence(data[area], refMap);
    const strip = (list) => list.map(({ claim, evidenceType, confidence, sourceIds }) => ({ claim, evidenceType, confidence, sourceIds }));
    const all = AREAS.flatMap((a) => resolved[a]);

    const priceIds = data.pricing ? [...new Set(data.pricing.sourceRefs.filter((r) => refMap.has(r)).map((r) => refMap.get(r)))] : [];
    const uncertainties = [...data.uncertainties];
    if (data.pricing && !priceIds.length) uncertainties.push("A pricing range was proposed without a valid source and was discarded.");
    const downgraded = all.filter((e) => e.downgraded).length;
    if (downgraded) uncertainties.push(`${downgraded} claim(s) labelled as sourced cited no valid source and were downgraded to INFERRED.`);

    return {
      status: "COMPLETED", confidence: overallConfidence(all), findings: toFindings(all),
      sources: docs.map((d) => d.sourceId), assumptions: [], uncertainties,
      recommendations: all.length ? [] : ["Sources contained little relevant evidence; broaden the research questions."],
      ...Object.fromEntries(AREAS.map((a) => [a, strip(resolved[a])])),
      competitorLeads: data.competitorLeads,
      pricing: data.pricing && priceIds.length ? { minimum: data.pricing.minimum, maximum: data.pricing.maximum, currency: data.pricing.currency, sourceIds: priceIds } : null,
    };
  }
}
