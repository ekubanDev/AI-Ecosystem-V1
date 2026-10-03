import mongoose from "mongoose";
import { getConfig } from "../config/env.js";
import { Blueprint, Competitor, BusinessModel, Experiment, Opportunity, Source } from "../models/index.js";
import { canTransition, OPPORTUNITY_FLOW, sourcesFor } from "../models/stateMachine.js";
import { AppError, conflict, invalidTransition, notFound } from "../utils/errors.js";
import { buildSort, escapeRegex } from "../utils/pagination.js";
import { distinctiveTokens, jaccard, nameKey, nameTokens, slugify } from "../utils/text.js";
import { actorFromReq, audit } from "./auditService.js";

const notDeleted = { isDeleted: { $ne: true } };
const LIST_EXCLUDE = "-evidence -analysis -uncertainties -assumptions -hypotheses -risks -differentiation -demandSignals";

export async function listOpportunities(q) {
  const filter = { ...notDeleted };
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = q.category;
  if (q.geography) filter["targetCustomer.geography"] = q.geography;
  if (q.businessModelType) filter["businessModel.type"] = q.businessModelType;
  if (q.createdBy) filter.createdBy = q.createdBy;
  if (q.q) {
    if (getConfig().SEARCH_MODE === "text") filter.$text = { $search: q.q };
    else {
      const rx = new RegExp(escapeRegex(q.q), "i");
      filter.$or = [{ name: rx }, { description: rx }, { problem: rx }];
    }
  }
  const sort = buildSort(q.sortBy, q.order, ["createdAt", "updatedAt", "name", "status", "category"]);
  const [items, total] = await Promise.all([
    Opportunity.find(filter).select(LIST_EXCLUDE).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit),
    Opportunity.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getOpportunity(id) {
  const opp = await Opportunity.findOne({ _id: id, ...notDeleted });
  if (!opp) throw notFound("Opportunity");
  const evidenceSourceIds = opp.evidence.map((e) => e.sourceId).filter(Boolean);
  const [competitors, businessModelDetail, experiments, sources, blueprint] = await Promise.all([
    Competitor.find({ opportunityId: opp._id }).sort({ name: 1 }),
    BusinessModel.findOne({ opportunityId: opp._id }),
    Experiment.find({ opportunityId: opp._id }).sort({ createdAt: -1 }),
    Source.find({ _id: { $in: [...opp.sourceIds, ...evidenceSourceIds] } }).select("-contentHash"),
    Blueprint.findOne({ opportunityId: opp._id }),
  ]);
  return { ...opp.toJSON(), competitors, businessModelDetail, experiments, sources, blueprint };
}

export async function createOpportunity(input, req) {
  const slug = slugify(input.name);
  if (!slug) throw new AppError("VALIDATION_ERROR", "Name must contain letters or digits.");
  if (await Opportunity.exists({ slug })) throw conflict("An opportunity with this name already exists.");
  const opp = await Opportunity.create({ ...input, slug, status: "DISCOVERED", createdBy: req.user.id });
  await audit({ actor: actorFromReq(req), action: "OPPORTUNITY_CREATED", resourceType: "Opportunity", resourceId: opp._id, after: { name: opp.name, status: opp.status }, req });
  return opp;
}

export async function updateOpportunity(id, patch, req) {
  const before = await Opportunity.findOne({ _id: id, ...notDeleted });
  if (!before) throw notFound("Opportunity");
  let slug;
  if (patch.name && patch.name !== before.name) {
    slug = slugify(patch.name);
    if (!slug) throw new AppError("VALIDATION_ERROR", "Name must contain letters or digits.");
    if (slug !== before.slug && (await Opportunity.exists({ slug, _id: { $ne: before._id } }))) throw conflict("An opportunity with this name already exists.");
  }
  const opp = await Opportunity.findOneAndUpdate({ _id: id, ...notDeleted }, { $set: { ...patch, ...(slug ? { slug } : {}) } }, { returnDocument: "after", runValidators: true });
  if (!opp) throw notFound("Opportunity");
  const changed = Object.keys(patch);
  await audit({
    actor: actorFromReq(req), action: "OPPORTUNITY_UPDATED", resourceType: "Opportunity", resourceId: opp._id,
    before: Object.fromEntries(changed.map((k) => [k, before.get(k)])), after: Object.fromEntries(changed.map((k) => [k, opp.get(k)])), req,
  });
  return opp;
}

export async function deleteOpportunity(id, req) {
  const opp = await Opportunity.findOneAndUpdate({ _id: id, ...notDeleted }, { $set: { isDeleted: true, deletedAt: new Date() } }, { returnDocument: "before" });
  if (!opp) throw notFound("Opportunity");
  await audit({ actor: actorFromReq(req), action: "OPPORTUNITY_DELETED", resourceType: "Opportunity", resourceId: opp._id, before: { name: opp.name, status: opp.status }, req });
}

/**
 * Atomic, audited status transition. The conditional update on the current status prevents races
 * (e.g. two concurrent approvals). `soft` returns null instead of throwing when the opportunity isn't in an allowed `from` state.
 */
export async function transitionOpportunity({ id, to, from, set = {}, unset, actor, req, metadata, soft = false }) {
  const allowedFrom = from ? [].concat(from) : sourcesFor(to);
  for (const f of allowedFrom) if (!canTransition(f, to)) throw invalidTransition(f, to);

  const update = { $set: { status: to, ...set } };
  if (unset) update.$unset = unset;
  const before = await Opportunity.findOneAndUpdate({ _id: id, ...notDeleted, status: { $in: allowedFrom } }, update, { returnDocument: "before" });

  if (!before) {
    if (soft) return null;
    const current = await Opportunity.findOne({ _id: id, ...notDeleted }).select("status");
    if (!current) throw notFound("Opportunity");
    throw invalidTransition(current.status, to);
  }
  const after = await Opportunity.findById(id);
  await audit({
    actor: actor ?? actorFromReq(req), action: "OPPORTUNITY_STATUS_CHANGED", resourceType: "Opportunity", resourceId: id,
    before: { status: before.status }, after: { status: to }, metadata, req,
  });
  return after;
}

export async function approveOpportunity(id, { note }, req) {
  const opp = await transitionOpportunity({
    id, to: "APPROVED", from: "AWAITING_APPROVAL", req,
    set: { approvedBy: req.user.id, approvedAt: new Date(), decision: { action: "APPROVED", note, by: req.user.id, at: new Date() } },
  });
  await audit({ actor: actorFromReq(req), action: "OPPORTUNITY_APPROVED", resourceType: "Opportunity", resourceId: id, metadata: { note }, req });
  return opp;
}

export async function rejectOpportunity(id, { reason }, req) {
  const opp = await transitionOpportunity({
    id, to: "REJECTED", req,
    set: { decision: { action: "REJECTED", note: reason, by: req.user.id, at: new Date() } }, unset: { pausedFromStatus: 1 },
  });
  await audit({ actor: actorFromReq(req), action: "OPPORTUNITY_REJECTED", resourceType: "Opportunity", resourceId: id, metadata: { reason }, req });
  return opp;
}

export async function pauseOpportunity(id, { note } = {}, req) {
  const current = await Opportunity.findOne({ _id: id, ...notDeleted }).select("status");
  if (!current) throw notFound("Opportunity");
  if (!OPPORTUNITY_FLOW.includes(current.status)) throw invalidTransition(current.status, "PAUSED");
  // Conditional on the status we read, so a concurrent transition can't leave a stale pausedFromStatus.
  return transitionOpportunity({
    id, to: "PAUSED", from: current.status, req,
    set: { pausedFromStatus: current.status, decision: { action: "PAUSED", note, by: req.user.id, at: new Date() } },
  });
}

export async function resumeOpportunity(id, req) {
  const current = await Opportunity.findOne({ _id: id, ...notDeleted }).select("status pausedFromStatus");
  if (!current) throw notFound("Opportunity");
  if (current.status !== "PAUSED" || !current.pausedFromStatus) throw invalidTransition(current.status, "RESUME");
  return transitionOpportunity({ id, to: current.pausedFromStatus, from: "PAUSED", unset: { pausedFromStatus: 1 }, req });
}

/** The company-name part of a candidate name: "AgroCenta - Agri Supply Chain Platform" and "AgroCenta Digital Market Platform" both give "agrocenta". */
export function brandOf(name) {
  const seg = String(name).split(/\s[-–—:]\s/)[0].trim();
  const words = seg.split(/\s+/);
  if (seg !== String(name).trim() && words.length <= 3 && nameKey(seg).length >= 4) return nameKey(seg);
  return /^[A-Z][a-z]+[A-Z][A-Za-z]{2,}$/.test(words[0]) ? words[0].toLowerCase() : null; // CamelCase first word, e.g. TradeDepot
}

export const toIndexEntry = ({ _id, name, slug }) => ({ id: _id, slug, key: nameKey(name), tokens: nameTokens(name), distinct: distinctiveTokens(name), brand: brandOf(name) });

/** Loads existing opportunity names once so a batch of candidates can be deduplicated without a query per candidate. */
export async function loadNameIndex() {
  const rows = await Opportunity.find(notDeleted).select("name slug").limit(10000);
  return rows.map(toIndexEntry);
}

/**
 * Same business under a different name? Duplicate if: same slug or normalized name; strongly overlapping name tokens
 * (Jaccard >= 0.8 with >= 2 tokens); or, ignoring generic business-type words, one name's distinctive words are (nearly)
 * contained in the other's: a lone shared brand word when a name is nothing but that brand, or >= 2 shared words covering
 * >= 60% of the shorter name; or the same company-name part (see brandOf). Live discovery produced six such pairs (TradeDepot, Shopa, AgroCenta, ...).
 */
export function findDuplicate(name, index) {
  const slug = slugify(name);
  const key = nameKey(name);
  const tokens = nameTokens(name);
  const distinct = distinctiveTokens(name);
  const brand = brandOf(name);
  const sameBusiness = (a, b) => {
    if (!a.size || !b.size) return false;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    const smaller = Math.min(a.size, b.size);
    return (smaller === 1 && shared === 1 && (a.size === 1 || b.size === 1)) || (shared >= 2 && shared / smaller >= 0.6);
  };
  return (
    index.find(
      (e) =>
        e.slug === slug || e.key === key ||
        (tokens.size >= 2 && e.tokens.size >= 2 && jaccard(tokens, e.tokens) >= 0.8) ||
        (brand && e.brand === brand) ||
        sameBusiness(distinct, e.distinct ?? new Set())
    ) ?? null
  );
}

export const newId = () => new mongoose.Types.ObjectId();
