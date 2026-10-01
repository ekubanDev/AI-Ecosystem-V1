import { z } from "zod";
import { BUSINESS_MODEL_TYPES, CONFIDENCE, EVIDENCE_TYPES, STRENGTH } from "../models/constants.js";
import { BaseAgent } from "./baseAgent.js";
import {
  SYSTEM_PROMPT, buildPrompt, capConfidence, commonOutput, enumCI, llmEvidenceItem, numberDocs, overallConfidence,
  refList, resolveEvidence, strList, toFindings,
} from "./agentUtils.js";

const inputSchema = z.object({
  market: z.string().trim().min(1).max(200),
  geography: z.array(z.string().trim().min(1)).max(20).default([]),
  categories: z.array(z.string().trim().min(1)).max(20).default([]),
  revenueModels: z.array(z.string().trim().min(1)).max(20).default([]),
  targetCount: z.number().int().min(1).max(50).default(20),
  objective: z.string().trim().max(1000).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

const queriesSchema = z.object({ queries: z.array(z.string().trim().min(3)).min(1).max(30) }); // the agent keeps only the first few; a hard cap here failed whole runs when the model over-delivered

const candidateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).default(""),
  description: z.string().trim().max(2000).default(""),
  customer: z.string().trim().max(500).default(""),
  problem: z.string().trim().max(2000).default(""),
  observedBusinessModel: z.object({ type: enumCI(BUSINESS_MODEL_TYPES).catch("OTHER"), revenueMechanism: z.string().trim().max(500).default("") }),
  demandSignals: z.array(z.object({ observation: z.string().trim().min(1), strength: enumCI(STRENGTH).catch("UNKNOWN"), sourceRefs: refList })).default([]),
  initialEvidence: z.array(llmEvidenceItem).default([]),
  sourceRefs: refList,
});
const llmSchema = z.object({ opportunities: z.array(candidateSchema).max(60), assumptions: strList(), uncertainties: strList() });

const outputSchema = z.object({
  ...commonOutput,
  mode: z.enum(["SEARCH", "KNOWLEDGE_ONLY"]),
  opportunities: z.array(
    z.object({
      name: z.string(), category: z.string(), description: z.string(), customer: z.string(), problem: z.string(),
      businessModel: z.object({ type: z.enum(BUSINESS_MODEL_TYPES), revenueMechanism: z.string() }),
      demandSignals: z.array(z.object({ source: z.string(), observation: z.string(), evidence: z.string(), strength: z.enum(STRENGTH) })),
      initialEvidence: z.array(z.object({ claim: z.string(), evidenceType: z.enum(EVIDENCE_TYPES), confidence: z.enum(CONFIDENCE), sourceIds: z.array(z.string()) })),
      sourceIds: z.array(z.string()),
    })
  ),
});

const ROLE = "You are the Opportunity Scout. You discover candidate online businesses/business models worth investigating. You discover; you do NOT make investment decisions or profitability claims.";

export class OpportunityScout extends BaseAgent {
  constructor() {
    super({
      agentType: "OPPORTUNITY_SCOUT", name: "Opportunity Scout", version: "0.1.0",
      description: "Finds candidate business opportunities from observable web evidence.",
      objective: "Discover structured opportunity candidates matching the request.",
      inputSchema, outputSchema,
      permissions: { read: ["discoveryRequest"], write: ["candidates", "sources"], external: ["search"] },
    });
  }

  async execute(input, ctx) {
    const request = { market: input.market, geography: input.geography, categories: input.categories, revenueModels: input.revenueModels, objective: input.objective, constraints: input.constraints };
    const raw = [];
    const seen = new Set();

    if (ctx.research?.searchAvailable) {
      const { data } = await ctx.ai.generateJSON({
        label: this.name, system: SYSTEM_PROMPT, schema: queriesSchema, signal: ctx.signal,
        prompt: buildPrompt({
          role: ROLE, objective: "Write up to 6 diverse web search queries that would surface existing online businesses / business models matching the request (pricing pages, directories, community threads, reviews). Every query must name the requested market or geography (e.g. Ghana, Africa) so results are about that region, not generic global or European coverage.",
          knownData: request,
        }),
      });
      for (const q of data.queries.slice(0, 6)) {
        for (const r of await ctx.research.search(q, { maxResults: 8, signal: ctx.signal })) {
          if (!seen.has(r.url) && raw.length < 40) {
            seen.add(r.url);
            raw.push({ url: r.url, title: r.title, text: r.snippet, sourceId: r.sourceId, snippetOnly: true });
          }
        }
      }
    }

    const searched = raw.length > 0;
    const { docs, refMap } = numberDocs(raw);
    const byId = new Map(docs.map((d) => [d.sourceId, d]));

    const { data } = await ctx.ai.generateJSON({
      label: this.name, system: SYSTEM_PROMPT, schema: llmSchema, signal: ctx.signal,
      prompt: buildPrompt({
        role: ROLE,
        objective: `Identify up to ${input.targetCount} distinct candidate businesses / business models that match the request${searched ? ", using ONLY the search results below as evidence" : ""}. Use observedBusinessModel.type from: ${BUSINESS_MODEL_TYPES.join(", ")}.`,
        knownData: request, docs: searched ? docs : undefined,
        constraints: searched
          ? ["Every candidate must cite at least one source ref that supports its existence.", "Search results may be snippets or pages; do not assert pricing or traction that they do not state.", "A candidate is a specific, named business or a concrete business model, never a generic category or report topic (not \"European B2B SaaS\" or \"API monetization models\").", "Prefer businesses operating in the requested market, or whose model could clearly be adapted to it; say in the description what the local gap would be. Skip candidates unrelated to the requested geography."]
          : ["No web sources are available. Work from general knowledge only: label every claim INFERRED or ASSUMED and cite no sources.", "Do not state facts about specific companies' pricing or traction."],
      }),
    });

    const opportunities = [];
    let dropped = 0;
    for (const c of data.opportunities) {
      const validRefs = c.sourceRefs.filter((r) => refMap.has(r));
      if (searched && validRefs.length === 0) {
        dropped++; // an observed candidate with no real source is not evidence of anything
        continue;
      }
      let evidence = resolveEvidence(c.initialEvidence, refMap, docs);
      if (!searched) evidence = evidence.map((e) => ({ ...e, evidenceType: ["ASSUMED", "UNKNOWN"].includes(e.evidenceType) ? e.evidenceType : "INFERRED", confidence: capConfidence(e.confidence, "LOW"), sourceIds: [] }));
      const sourceIds = [...new Set(validRefs.map((r) => refMap.get(r)))];
      opportunities.push({
        name: c.name, category: c.category, description: c.description, customer: c.customer, problem: c.problem,
        businessModel: { type: c.observedBusinessModel.type, revenueMechanism: c.observedBusinessModel.revenueMechanism },
        demandSignals: c.demandSignals.map((d) => {
          const ids = [...new Set(d.sourceRefs.filter((r) => refMap.has(r)).map((r) => refMap.get(r)))];
          return {
            source: ids.length ? ids.map((id) => byId.get(id).url).join(", ") : "model knowledge (no source)",
            observation: d.observation, evidence: ids.length ? "cited" : "uncited",
            strength: ids.length ? d.strength : ["STRONG", "MODERATE"].includes(d.strength) ? "WEAK" : d.strength,
          };
        }),
        initialEvidence: evidence.map(({ claim, evidenceType, confidence, sourceIds: s }) => ({ claim, evidenceType, confidence, sourceIds: s })),
        sourceIds,
      });
    }
    const limited = opportunities.slice(0, input.targetCount);

    const uncertainties = [...data.uncertainties];
    if (!searched) uncertainties.push("No web search was available: candidates come from model knowledge only and are unverified hypotheses.");
    if (dropped) uncertainties.push(`${dropped} candidate(s) were discarded because they cited no valid source.`);
    if (limited.length < input.targetCount) uncertainties.push(`Found ${limited.length} of ${input.targetCount} requested candidates.`);

    const allEvidence = limited.flatMap((o) => o.initialEvidence);
    return {
      status: "COMPLETED", mode: searched ? "SEARCH" : "KNOWLEDGE_ONLY",
      confidence: searched ? overallConfidence(allEvidence) : "LOW",
      findings: toFindings(allEvidence.map((e) => ({ claim: e.claim, ...e }))),
      sources: [...new Set(limited.flatMap((o) => o.sourceIds))],
      assumptions: data.assumptions, uncertainties,
      recommendations: ["Deduplicate against existing opportunities, then research each candidate before any analysis."],
      opportunities: limited,
    };
  }
}
