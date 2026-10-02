const SOURCED = new Set(["VERIFIED", "SUPPORTED"]);

/**
 * Counts, not a score: the product shows the evidence behind a judgement rather than hiding it behind one number
 * (Blueprint §10). `sourced` means labelled VERIFIED/SUPPORTED *and* citing a stored source.
 */
export function evidenceQuality(o) {
  const evidence = o?.evidence ?? [];
  const sourced = evidence.filter((e) => SOURCED.has(e.evidenceType) && e.sourceId).length;
  const guessed = evidence.filter((e) => !SOURCED.has(e.evidenceType)).length; // inferred, estimated, assumed, unknown
  const high = evidence.filter((e) => e.confidence === "HIGH").length;
  // The agents record downgrades only as a sentence in `uncertainties`, e.g. "3 claim(s) labelled as sourced ... were downgraded".
  const downgraded = (o?.uncertainties ?? []).reduce((n, u) => n + (/downgraded to INFERRED/i.test(u) ? Number(/^(\d+)/.exec(u)?.[1] ?? 0) : 0), 0);
  return { total: evidence.length, sourced, guessed, high, sources: o?.sources?.length ?? 0, downgraded, sourcedShare: evidence.length ? sourced / evidence.length : null };
}
