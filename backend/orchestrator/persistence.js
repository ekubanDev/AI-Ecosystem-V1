import { BusinessModel, Competitor, Opportunity, Source } from "../models/index.js";
import { AppError } from "../utils/errors.js";
import { nameKey, slugify } from "../utils/text.js";
import { AGENT_ACTOR, audit } from "../services/auditService.js";
import { findDuplicate, loadNameIndex } from "../services/opportunityService.js";
import { WRITE_KIND } from "./workflowRegistry.js";

const RESEARCH_AREAS = { marketEvidence: "market", customerEvidence: "customer", pricingEvidence: "pricing", competitorEvidence: "competitor", businessModelEvidence: "businessModel" };
const CAPITAL_MAP = { LOW: "LOW", LOW_TO_MEDIUM: "MEDIUM", MEDIUM: "MEDIUM", HIGH: "HIGH" };

/** Least-privilege enforcement: an agent's output may only be stored in the kind of record it declared write access to. */
export function assertWritePermission(agent) {
  const kind = WRITE_KIND[agent.agentType];
  if (!kind || !agent.permissions.write.includes(kind)) {
    throw new AppError("FORBIDDEN", `${agent.name} is not permitted to write '${kind}'.`);
  }
}

const expandEvidence = (items, area) =>
  items.flatMap((e) =>
    (e.sourceIds.length ? e.sourceIds : [undefined]).map((sourceId) => ({ claim: e.claim, sourceId, evidenceType: e.evidenceType, confidence: e.confidence, area }))
  );

const validUrl = (u) => {
  try {
    return ["http:", "https:"].includes(new URL(u).protocol) ? u : null;
  } catch {
    return null;
  }
};

/** Creates Opportunity records from Scout candidates, skipping duplicates. Returns the created opportunities. */
export async function persistScout(output, { agent, run, requestedBy, defaults = {} }) {
  const index = await loadNameIndex();
  const created = [];
  let duplicates = 0;
  for (const c of output.opportunities) {
    if (findDuplicate(c.name, index)) {
      duplicates++;
      continue;
    }
    let opp;
    try {
      opp = await Opportunity.create({
        name: c.name, slug: slugify(c.name), category: c.category, description: c.description,
        sourceIds: c.sourceIds, targetCustomer: { segment: c.customer, geography: defaults.geography },
        problem: c.problem, businessModel: c.businessModel, demandSignals: c.demandSignals,
        evidence: expandEvidence(c.initialEvidence, "initial"),
        uncertainties: output.uncertainties, status: "DISCOVERED",
        discoveryRunId: run?._id, createdBy: requestedBy,
      });
    } catch (err) {
      if (err.code === 11000) {
        duplicates++;
        continue;
      }
      throw err;
    }
    created.push(opp);
    index.push({ id: opp._id, slug: opp.slug, key: nameKey(opp.name), tokens: new Set(opp.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) });
    if (c.sourceIds.length) await Source.updateMany({ _id: { $in: c.sourceIds } }, { $addToSet: { opportunityIds: opp._id } });
    await audit({ actor: AGENT_ACTOR(agent.agentType), action: "OPPORTUNITY_CREATED", resourceType: "Opportunity", resourceId: opp._id, after: { name: opp.name, status: opp.status }, metadata: { discoveryRunId: run && String(run._id) } });
  }
  return { created, duplicates };
}

export async function persistResearch(oppId, output) {
  const opp = await Opportunity.findById(oppId).select("evidence pricing");
  if (!opp) return;
  const researchAreas = new Set(Object.values(RESEARCH_AREAS));
  const kept = opp.evidence.filter((e) => !researchAreas.has(e.area)).map((e) => e.toObject());
  const fresh = Object.entries(RESEARCH_AREAS).flatMap(([key, area]) => expandEvidence(output[key], area));

  const $set = { evidence: [...kept, ...fresh] };
  if (output.pricing && opp.pricing?.minimum == null) {
    $set["pricing.minimum"] = Math.min(output.pricing.minimum, output.pricing.maximum);
    $set["pricing.maximum"] = Math.max(output.pricing.minimum, output.pricing.maximum);
    $set["pricing.currency"] = output.pricing.currency.toUpperCase();
    $set["pricing.pricingEvidence"] = output.pricingEvidence.map((e) => e.claim).join("; ").slice(0, 2000) || "Source-backed price range";
  }
  await Opportunity.updateOne(
    { _id: oppId },
    { $set, $addToSet: { sourceIds: { $each: output.sources }, uncertainties: { $each: output.uncertainties } } }
  );
  if (output.sources.length) await Source.updateMany({ _id: { $in: output.sources } }, { $addToSet: { opportunityIds: oppId } });
}

export async function persistCompetitors(oppId, output) {
  for (const c of output.competitors) {
    await Competitor.findOneAndUpdate(
      { opportunityId: oppId, nameKey: nameKey(c.name) },
      {
        $set: {
          name: c.name, website: c.website && validUrl(c.website), customerSegment: c.customerSegment, geography: c.geography,
          products: c.products, pricing: c.pricing, businessModel: c.businessModel, acquisitionChannels: c.acquisitionChannels,
          strengths: c.strengths, weaknesses: c.weaknesses, customerComplaints: c.customerComplaints,
          differentiationOpportunities: c.differentiationOpportunities, evidenceIds: c.sourceIds,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
  }
  const ids = (await Competitor.find({ opportunityId: oppId }).select("_id")).map((c) => c._id);
  await Opportunity.updateOne({ _id: oppId }, { $set: { competitors: ids }, $addToSet: { uncertainties: { $each: output.uncertainties } } });
}

export async function persistBusinessModel(oppId, output) {
  const m = output.businessModel;
  const fields = ["customer", "problem", "valueProposition", "product", "acquisition", "conversion", "pricing", "delivery", "retention", "upsell", "referral"];
  const flat = Object.fromEntries(fields.map((f) => [f, m[f].value]));
  const evidenceTypes = Object.fromEntries(fields.map((f) => [f, m[f].evidenceType]));
  await BusinessModel.findOneAndUpdate(
    { opportunityId: oppId },
    {
      $set: {
        ...flat, revenueModel: m.revenueModel, operationalDependencies: m.operationalDependencies, technologyDependencies: m.technologyDependencies,
        evidenceTypes, confidence: output.confidence, generatedByAgent: "BUSINESS_MODEL",
      },
    },
    { upsert: true, returnDocument: "after" }
  );
  const opp = await Opportunity.findById(oppId).select("businessModel retentionMechanism");
  const $set = {};
  if (!opp.businessModel?.type) $set["businessModel.type"] = m.revenueModel;
  if (!opp.retentionMechanism && m.retention.evidenceType !== "UNKNOWN") $set.retentionMechanism = m.retention.value;
  await Opportunity.updateOne({ _id: oppId }, { ...(Object.keys($set).length ? { $set } : {}), $addToSet: { uncertainties: { $each: output.uncertainties } } });
}

export async function persistAnalysis(oppId, output) {
  const a = output.assessment;
  const opp = await Opportunity.findById(oppId).select("hypotheses");
  const existing = new Set(opp.hypotheses.map((h) => h.statement));
  const $set = {
    analysis: { assessment: a, confidence: output.confidence, agentVersion: "0.1.0" },
    analyzedAt: new Date(),
    "complexity.technical": a.technicalComplexity,
    "complexity.operational": a.operationalComplexity,
    "complexity.capital": CAPITAL_MAP[a.capitalRequirement],
    risks: a.risks,
    differentiation: a.differentiationOpportunities,
    validationPlan: { objective: a.validationRecommendation.objective, method: a.validationRecommendation.method, budget: a.validationRecommendation.budget ?? undefined, successCriteria: a.validationRecommendation.successCriteria },
  };
  if (a.economics) {
    Object.assign($set, {
      "economics.estimatedCAC": a.economics.estimatedCAC ?? undefined, "economics.estimatedLTV": a.economics.estimatedLTV ?? undefined,
      "economics.estimatedARPU": a.economics.estimatedARPU ?? undefined, "economics.estimatedMargin": a.economics.estimatedMargin ?? undefined,
      "economics.confidence": a.economics.confidence, "economics.basis": a.economics.basis,
    });
    for (const k of Object.keys($set)) if ($set[k] === undefined) delete $set[k];
  }
  await Opportunity.updateOne(
    { _id: oppId },
    {
      $set,
      $addToSet: {
        uncertainties: { $each: output.uncertainties }, assumptions: { $each: output.assumptions },
        hypotheses: { $each: a.hypotheses.filter((s) => !existing.has(s)).map((statement) => ({ statement, status: "UNTESTED" })) },
      },
    }
  );
}
