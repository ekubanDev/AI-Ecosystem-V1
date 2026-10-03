import { LANDING_STATUSES } from "../models/constants.js";
import { Lead, Opportunity } from "../models/index.js";
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
