import { LANDING_STATUSES } from "../models/constants.js";
import { LandingStat, Lead, Opportunity } from "../models/index.js";
import { AppError, notFound } from "../utils/errors.js";
import { actorFromReq, audit } from "./auditService.js";

/** What the person is agreeing to, derived server-side so the stored consent always matches what the page displayed. */
export const consentTextFor = (name) =>
  `I agree that ${name} may store the details I enter here and contact me about this offer. I can ask for them to be deleted at any time.`;

const publicOpportunity = async (slug) => {
  const opp = await Opportunity.findOne({ slug, isDeleted: { $ne: true }, "landing.enabled": true, status: { $in: LANDING_STATUSES } });
  if (!opp) throw notFound("Page"); // same answer for missing, unpublished and paused pages: nothing leaks
  return opp;
};

/** Public: only fields written for the public. Never the opportunity's research, evidence or analysis. */
export async function getPublicLanding(slug) {
  const opp = await publicOpportunity(slug);
  const l = opp.landing;
  return {
    slug: opp.slug,
    name: opp.name,
    headline: l.headline || opp.name,
    subheadline: l.subheadline ?? null,
    bullets: l.bullets ?? [],
    ctaLabel: l.ctaLabel || "Register my interest",
    consentText: consentTextFor(opp.name),
  };
}

/** Public: records interest. Always answers the same way for a repeat email so the form cannot be used to probe who signed up. */
export async function submitLead(slug, body, req) {
  if (body.website) return { received: true }; // honeypot tripped: pretend success, store nothing
  const opp = await publicOpportunity(slug);
  const { website: _hp, consent: _c, ...fields } = body;
  try {
    const lead = await Lead.create({ ...fields, opportunityId: opp._id, consent: { text: consentTextFor(opp.name), at: new Date() } });
    // No personal data in the audit trail: ids only.
    await audit({ actor: { type: "SYSTEM" }, action: "LEAD_CAPTURED", resourceType: "Lead", resourceId: lead._id, metadata: { opportunityId: String(opp._id) }, req });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return { received: true };
}

export async function updateLanding(opportunityId, input, req) {
  const opp = await Opportunity.findOne({ _id: opportunityId, isDeleted: { $ne: true } });
  if (!opp) throw notFound("Opportunity");
  if (input.enabled && !LANDING_STATUSES.includes(opp.status)) {
    throw new AppError("INVALID_STATE_TRANSITION", `A landing page can only be published for an approved opportunity (this one is ${opp.status}).`);
  }
  const before = opp.landing?.toObject?.() ?? {};
  const landing = {
    enabled: input.enabled,
    headline: input.headline ?? "",
    subheadline: input.subheadline ?? "",
    bullets: input.bullets ?? [],
    ctaLabel: input.ctaLabel ?? "",
    updatedAt: new Date(),
    updatedBy: req.user.id,
  };
  const updated = await Opportunity.findOneAndUpdate({ _id: opp._id }, { $set: { landing } }, { returnDocument: "after" });
  await audit({ actor: actorFromReq(req), action: "LANDING_PAGE_UPDATED", resourceType: "Opportunity", resourceId: opp._id, before, after: updated.landing, req });
  return updated.landing;
}

export async function listLeads(q) {
  const filter = {};
  if (q.opportunityId) filter.opportunityId = q.opportunityId;
  if (q.status) filter.status = q.status;
  const sort = { createdAt: q.order === "asc" ? 1 : -1 };
  const [items, total] = await Promise.all([
    Lead.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit),
    Lead.countDocuments(filter),
  ]);
  return { items, total };
}

export async function updateLead(id, patch, req) {
  const before = await Lead.findById(id).select("status");
  if (!before) throw notFound("Lead");
  const lead = await Lead.findOneAndUpdate({ _id: id }, { $set: patch }, { returnDocument: "after", runValidators: true });
  await audit({ actor: actorFromReq(req), action: "LEAD_UPDATED", resourceType: "Lead", resourceId: lead._id, before: { status: before.status }, after: { status: lead.status }, metadata: { fields: Object.keys(patch) }, req });
  return lead;
}

/** Hard delete: the consent text promises deletion on request, so this must really remove the personal data. */
export async function deleteLead(id, req) {
  const lead = await Lead.findOneAndDelete({ _id: id });
  if (!lead) throw notFound("Lead");
  await audit({ actor: actorFromReq(req), action: "LEAD_DELETED", resourceType: "Lead", resourceId: lead._id, metadata: { opportunityId: String(lead.opportunityId) }, req });
  return { deleted: true };
}

const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);

/** Public: counts one view of a *published* page. Counters only: nothing identifying the visitor is stored. */
export async function recordView(slug, { source } = {}) {
  const opp = await publicOpportunity(slug);
  await LandingStat.updateOne(
    { opportunityId: opp._id, day: dayOf(), source: source ?? "" },
    { $inc: { views: 1 }, $set: { lastViewAt: new Date() } },
    { upsert: true }
  );
  return { recorded: true };
}

const STAT_DAYS = 30;

/**
 * Views, leads and conversion for one opportunity's landing page. Views and leads are matched by day and source here,
 * not stored together, so a lead from before view counting began has no matching view: the rate is capped at 100%.
 */
export async function getLandingStats(opportunityId) {
  const opp = await Opportunity.findOne({ _id: opportunityId, isDeleted: { $ne: true } }).select("_id");
  if (!opp) throw notFound("Opportunity");
  const since = dayOf(new Date(Date.now() - (STAT_DAYS - 1) * 86400000));
  const [totals, viewDays, viewSources, leads, leadDays, leadSources] = await Promise.all([
    LandingStat.aggregate([{ $match: { opportunityId: opp._id } }, { $group: { _id: null, views: { $sum: "$views" }, last: { $max: "$lastViewAt" } } }]),
    LandingStat.aggregate([{ $match: { opportunityId: opp._id, day: { $gte: since } } }, { $group: { _id: "$day", views: { $sum: "$views" } } }]),
    LandingStat.aggregate([{ $match: { opportunityId: opp._id } }, { $group: { _id: "$source", views: { $sum: "$views" } } }]),
    Lead.countDocuments({ opportunityId: opp._id }),
    Lead.aggregate([{ $match: { opportunityId: opp._id, createdAt: { $gte: new Date(`${since}T00:00:00Z`) } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, leads: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { opportunityId: opp._id } }, { $group: { _id: { $ifNull: ["$source", ""] }, leads: { $sum: 1 } } }]),
  ]);
  const views = totals[0]?.views ?? 0;

  const byDay = [];
  const vd = new Map(viewDays.map((r) => [r._id, r.views]));
  const ld = new Map(leadDays.map((r) => [r._id, r.leads]));
  for (let i = STAT_DAYS - 1; i >= 0; i--) {
    const day = dayOf(new Date(Date.now() - i * 86400000));
    byDay.push({ day, views: vd.get(day) ?? 0, leads: ld.get(day) ?? 0 });
  }
  const sources = new Map();
  for (const r of viewSources) sources.set(r._id, { source: r._id, views: r.views, leads: 0 });
  for (const r of leadSources) sources.set(r._id, { source: r._id, views: sources.get(r._id)?.views ?? 0, leads: r.leads });

  return {
    views, leads,
    conversionRate: views > 0 ? Math.round(Math.min(1, leads / views) * 10000) / 10000 : null,
    lastViewAt: totals[0]?.last ?? null,
    byDay,
    bySource: [...sources.values()].sort((a, b) => b.views + b.leads - (a.views + a.leads)),
  };
}
