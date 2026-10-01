import { z } from "zod";
import { BaseAgent } from "./baseAgent.js";
import { SYSTEM_PROMPT, buildPrompt, commonOutput, enumCI, numberDocs, refList, strList } from "./agentUtils.js";
import { EVIDENCE_TYPES } from "../models/constants.js";

const inputSchema = z.object({
  opportunityId: z.string(),
  opportunity: z.object({ name: z.string() }).passthrough(),
  competitors: z.array(z.string().trim().min(1)).max(20).default([]),
  evidence: z.array(z.object({ claim: z.string() }).passthrough()).max(100).default([]),
});

const queriesSchema = z.object({ queries: z.array(z.string().trim().min(3)).min(1).max(30) }); // the agent keeps only the first few; a hard cap here failed whole runs when the model over-delivered

const nullableStr = z.string().trim().max(1000).nullish(); // normalized to null after parsing (transforms cannot be expressed in JSON Schema)
const llmSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string().trim().min(1).max(200),
      website: nullableStr,
      customerSegment: nullableStr,
      geography: nullableStr,
      products: strList(15),
      pricing: nullableStr,
      businessModel: nullableStr,
      acquisitionChannels: strList(15),
      strengths: strList(15),
      weaknesses: strList(15),
      customerComplaints: strList(15),
      differentiationOpportunities: strList(15),
      evidenceType: enumCI(EVIDENCE_TYPES),
      sourceRefs: refList,
    })
  ).max(12),
  uncertainties: strList(),
});

const outputSchema = z.object({
  ...commonOutput,
  competitors: z.array(
    z.object({
      name: z.string(), website: z.string().nullable(), customerSegment: z.string().nullable(), geography: z.string().nullable(),
      products: z.array(z.string()), pricing: z.string().nullable(), businessModel: z.string().nullable(),
      acquisitionChannels: z.array(z.string()), strengths: z.array(z.string()), weaknesses: z.array(z.string()),
      customerComplaints: z.array(z.string()), differentiationOpportunities: z.array(z.string()),
      evidenceType: z.enum(EVIDENCE_TYPES), sourceIds: z.array(z.string()),
    })
  ),
});

const ROLE = "You are the Competitor Agent. You profile existing competitors/alternatives for one opportunity using only evidence you are given.";

export class CompetitorAgent extends BaseAgent {
  constructor() {
    super({
      agentType: "COMPETITOR", name: "Competitor Agent", version: "0.1.0",
      description: "Profiles competitors and alternatives; unknown fields stay unknown.",
      objective: "Produce sourced competitor profiles.",
      inputSchema, outputSchema,
      permissions: { read: ["evidence", "opportunities"], write: ["competitors"], external: ["search", "fetch"] },
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

    if (ctx.research?.searchAvailable) {
      const { data } = await ctx.ai.generateJSON({
        label: this.name, system: SYSTEM_PROMPT, schema: queriesSchema, signal: ctx.signal,
        prompt: buildPrompt({
          role: ROLE, objective: "Write up to 5 web search queries that find competitors/alternatives to this opportunity, their pricing pages, and customer complaints (reviews). Include the known competitor names.",
          knownData: { opportunity: opp, knownCompetitors: input.competitors },
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

    if (!raw.length) {
      return {
        status: "COMPLETED", confidence: "UNKNOWN", findings: [], sources: [], assumptions: [], competitors: [],
        uncertainties: ["No source material available; competitors were not profiled rather than invented."],
        recommendations: ["Configure SEARCH_PROVIDER, then re-run analysis."],
      };
    }

    const { docs, refMap } = numberDocs(raw);
    const { data } = await ctx.ai.generateJSON({
      label: this.name, system: SYSTEM_PROMPT, schema: llmSchema, signal: ctx.signal,
      prompt: buildPrompt({
        role: ROLE, objective: "Profile up to 8 real competitors/alternatives found in the sources. Use null / [] for anything the sources do not state.",
        knownData: { opportunity: opp, knownCompetitors: input.competitors, priorEvidence: input.evidence.slice(0, 40).map((e) => e.claim) }, docs,
        constraints: ["Do not invent pricing, customers, complaints or websites.", "pricing and customerComplaints must come from a cited source; otherwise use null / []."],
      }),
    });

    let stripped = 0;
    const competitors = data.competitors.map((c) => {
      const sourceIds = [...new Set(c.sourceRefs.filter((r) => refMap.has(r)).map((r) => refMap.get(r)))];
      let evidenceType = c.evidenceType;
      let { pricing, customerComplaints } = c;
      if (!sourceIds.length) {
        // No real citation: keep only what needs none and drop factual claims a model could have invented.
        if (pricing || customerComplaints.length) stripped++;
        pricing = null;
        customerComplaints = [];
        if (["VERIFIED", "SUPPORTED"].includes(evidenceType)) evidenceType = "INFERRED";
      }
      const { sourceRefs: _r, ...rest } = c;
      return {
        ...rest, website: c.website || null, customerSegment: c.customerSegment || null, geography: c.geography || null,
        businessModel: c.businessModel || null, pricing: pricing || null, customerComplaints, evidenceType, sourceIds,
      };
    });

    const uncertainties = [...data.uncertainties];
    if (stripped) uncertainties.push(`Pricing/complaints for ${stripped} competitor(s) were removed because no valid source was cited.`);
    const cited = competitors.filter((c) => c.sourceIds.length).length;
    return {
      status: "COMPLETED", confidence: competitors.length && cited === competitors.length ? "MEDIUM" : competitors.length ? "LOW" : "UNKNOWN",
      findings: competitors.map((c) => ({ statement: `Competitor: ${c.name}`, evidenceType: c.evidenceType, confidence: c.sourceIds.length ? "MEDIUM" : "LOW", sourceIds: c.sourceIds })),
      sources: docs.map((d) => d.sourceId), assumptions: [], uncertainties, recommendations: [], competitors,
    };
  }
}
