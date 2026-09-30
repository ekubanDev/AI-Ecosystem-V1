import { Source } from "../models/index.js";
import { normalizeUrl, sha256, truncate } from "../utils/text.js";

const DOMAIN_TYPES = [
  [/producthunt\.com$/, "PRODUCT_HUNT"],
  [/(^|\.)reddit\.com$/, "REDDIT"],
  [/(apps\.apple\.com|play\.google\.com)$/, "APP_STORE"],
  [/\.gov(\.[a-z]{2})?$/, "GOVERNMENT"],
  [/(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com)$/, "SOCIAL"],
  [/(g2\.com|capterra\.com|alternativeto\.net|getapp\.com)$/, "DIRECTORY"],
];

export const guessSourceType = (url, hint) => {
  const host = new URL(url).hostname;
  for (const [rx, type] of DOMAIN_TYPES) if (rx.test(host)) return type;
  if (/\/pricing\/?$/i.test(new URL(url).pathname)) return "PRICING_PAGE";
  return hint ?? "OTHER";
};

/**
 * Upserts a Source. Dedupes by normalized URL first, then content hash. Returns the Source document.
 * `text` (full page text) is hashed but never stored; only a short summary is kept.
 */
export async function upsertSource({ url, title, text, summary, sourceType, publisher, publishedAt, reliability, opportunityId }) {
  const normalized = normalizeUrl(url);
  const contentHash = text ? sha256(text) : undefined;
  const link = opportunityId ? { $addToSet: { opportunityIds: opportunityId } } : {};

  const set = {
    retrievedAt: new Date(),
    ...(title ? { title: truncate(title, 500) } : {}),
    ...(summary || text ? { contentSummary: truncate(summary ?? text, 1000) } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(reliability ? { reliability } : {}),
  };

  const byUrl = await Source.findOneAndUpdate({ url: normalized }, { $set: set, ...link }, { returnDocument: "after" });
  if (byUrl) return byUrl;

  if (contentHash) {
    const byHash = await Source.findOneAndUpdate({ contentHash }, link.$addToSet ? link : { $set: { retrievedAt: new Date() } }, { returnDocument: "after" });
    if (byHash) return byHash;
  }

  const domain = new URL(normalized).hostname;
  try {
    return await Source.create({
      ...set, url: normalized, domain, sourceType: guessSourceType(normalized, sourceType),
      opportunityIds: opportunityId ? [opportunityId] : [],
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    return Source.findOneAndUpdate({ url: normalized }, { $set: set, ...link }, { returnDocument: "after" });
  }
}
