import { AppError } from "../utils/errors.js";
import { htmlToText } from "../utils/html.js";
import { safeFetchText } from "../utils/safeFetch.js";
import { upsertSource } from "./sourceService.js";

const MAX_PAGE_CHARS = 20000;

/**
 * Web research capability handed to agents that have external permission.
 * Every result is persisted as a Source, so downstream claims can cite real, inspectable records instead of model-invented ones.
 */
export function createResearchService({ searchProvider = null, fetcher = safeFetchText, blockedDomains = [] } = {}) {
  const blocked = blockedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  const isBlocked = (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return blocked.some((d) => host === d || host.endsWith(`.${d}`));
    } catch {
      return false;
    }
  };

  return {
    searchAvailable: Boolean(searchProvider),

    /** @returns {Promise<Array<{title:string,url:string,snippet:string,sourceId:string}>>} */
    async search(query, { maxResults = 8, opportunityId, signal } = {}) {
      if (!searchProvider) throw new AppError("EXTERNAL_SERVICE_ERROR", "No search provider configured.", { retryable: false });
      const results = await searchProvider.search(query, { maxResults, signal });
      const out = [];
      for (const r of results) {
        if (!r?.url || isBlocked(r.url)) continue; // e.g. stock-quote and contact-scraper pages: noise that still gets cited as evidence
        try {
          const src = await upsertSource({ url: r.url, title: r.title, summary: r.snippet, sourceType: "SEARCH_RESULT", opportunityId });
          out.push({ title: r.title ?? src.title, url: src.url, snippet: r.snippet ?? "", sourceId: String(src._id) });
        } catch {
          // Skip results with unusable URLs.
        }
      }
      return out;
    },

    /** Fetches and stores a page; returns null (rather than throwing) for pages that can't be fetched, so one dead link doesn't sink a run. */
    async fetchPage(url, { opportunityId, signal } = {}) {
      let raw;
      try {
        raw = await fetcher(url, { signal });
      } catch (err) {
        if (err.code === "FORBIDDEN" || err.code === "VALIDATION_ERROR") return null;
        if (signal?.aborted) throw err;
        return null;
      }
      const isHtml = /html/i.test(raw.contentType);
      const { title, text } = isHtml ? htmlToText(raw.body) : { title: undefined, text: raw.body.trim() };
      if (!text) return null;
      const clipped = text.slice(0, MAX_PAGE_CHARS);
      const src = await upsertSource({ url: raw.finalUrl, title, text: clipped, summary: clipped.slice(0, 500), opportunityId });
      return { sourceId: String(src._id), url: src.url, title: title ?? src.title, text: clipped };
    },
  };
}
