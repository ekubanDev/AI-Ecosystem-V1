import { describe, expect, it } from "vitest";
import { conversionLabel, lowSample } from "../utils/landingStats.js";

describe("landing stats helpers", () => {
  it("formats conversion as a percentage and shows a dash when there are no views", () => {
    expect(conversionLabel({ conversionRate: null })).toBe("—");
    expect(conversionLabel({ conversionRate: 0 })).toBe("0%");
    expect(conversionLabel({ conversionRate: 0.125 })).toBe("12.5%");
    expect(conversionLabel({ conversionRate: 1 })).toBe("100%");
    expect(conversionLabel(undefined)).toBe("—");
  });
  it("calls fewer than 30 views a low sample", () => {
    expect(lowSample({ views: 0 })).toBe(true);
    expect(lowSample({ views: 29 })).toBe(true);
    expect(lowSample({ views: 30 })).toBe(false);
    expect(lowSample(undefined)).toBe(true);
  });
});
