import { AppError } from "../utils/errors.js";

const call = async (url, init, name) => {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(15000), ...(init.signal ? [init.signal] : [])]) });
  } catch (err) {
    throw new AppError("EXTERNAL_SERVICE_ERROR", `${name} search failed: ${err.message}`, { retryable: true, cause: err });
  }
  if (!res.ok) throw new AppError("EXTERNAL_SERVICE_ERROR", `${name} search returned HTTP ${res.status}.`, { retryable: res.status === 429 || res.status >= 500 });
  return res.json();
};

/**
 * Search providers return [{ title, url, snippet }]. NOTE: the Tavily and Brave adapters follow their public API docs
 * but have not been exercised against the live services in this repository's tests (which use an injected fake provider).
 */
export const tavily = (apiKey) => ({
  name: "tavily",
  async search(query, { maxResults = 8, signal } = {}) {
    const json = await call(
      "https://api.tavily.com/search",
      { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query, max_results: maxResults }) },
      "Tavily"
    );
    return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
  },
});

export const brave = (apiKey) => ({
  name: "brave",
  async search(query, { maxResults = 8, signal } = {}) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const json = await call(url, { signal, headers: { accept: "application/json", "x-subscription-token": apiKey } }, "Brave");
    return (json.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
  },
});

export const createSearchProvider = (config) => {
  if (config.SEARCH_PROVIDER === "none") return null;
  if (!config.SEARCH_API_KEY) throw new Error(`SEARCH_PROVIDER=${config.SEARCH_PROVIDER} requires SEARCH_API_KEY`);
  return { tavily, brave }[config.SEARCH_PROVIDER](config.SEARCH_API_KEY);
};
