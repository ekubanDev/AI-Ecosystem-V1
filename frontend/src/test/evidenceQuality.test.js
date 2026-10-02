import { describe, expect, it } from "vitest";
import { evidenceQuality } from "../utils/evidenceQuality.js";

describe("evidenceQuality", () => {
  it("counts sourced, guessed and high-confidence claims and sources", () => {
    const q = evidenceQuality({
      evidence: [
        { evidenceType: "VERIFIED", sourceId: "a", confidence: "HIGH" },
        { evidenceType: "SUPPORTED", sourceId: "b", confidence: "MEDIUM" },
        { evidenceType: "VERIFIED", confidence: "MEDIUM" }, // labelled sourced but cites nothing: not counted as sourced
        { evidenceType: "INFERRED", confidence: "LOW" },
      ],
      sources: [{}, {}, {}],
    });
    expect(q).toMatchObject({ total: 4, sourced: 2, guessed: 1, high: 1, sources: 3, sourcedShare: 0.5 });
  });
  it("sums the downgrade notes the agents record in uncertainties", () => {
    const q = evidenceQuality({
      evidence: [],
      uncertainties: ["2 claim(s) labelled as sourced cited no valid source, or cited text that does not support them, and were downgraded to INFERRED.", "1 field(s) claimed evidence support without citing any evidence and were downgraded to INFERRED.", "Something unrelated"],
    });
    expect(q.downgraded).toBe(3);
  });
  it("never throws on a sparse opportunity", () => {
    expect(evidenceQuality({})).toMatchObject({ total: 0, sourcedShare: null, downgraded: 0, sources: 0 });
    expect(evidenceQuality(undefined).total).toBe(0);
  });
});
