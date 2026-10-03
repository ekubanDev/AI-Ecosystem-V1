import { describe, expect, it } from "vitest";
import { parseBullets, validateLead } from "../utils/leadForm.js";

describe("validateLead", () => {
  it("requires name, a plausible email and consent", () => {
    expect(validateLead({})).toEqual({ name: expect.any(String), email: expect.any(String), consent: expect.any(String) });
    expect(validateLead({ name: "Ama", email: "ama@example", consent: true }).email).toMatch(/does not look right/);
    expect(validateLead({ name: "Ama", email: "ama@example.com", consent: true })).toEqual({});
  });
  it("does not accept whitespace as a name", () => {
    expect(validateLead({ name: "   ", email: "a@b.co", consent: true }).name).toBeDefined();
  });
});

describe("parseBullets", () => {
  it("splits lines, drops blanks and keeps at most six", () => {
    expect(parseBullets(" one \n\n two\n")).toEqual(["one", "two"]);
    expect(parseBullets(Array.from({ length: 9 }, (_, i) => `b${i}`).join("\n"))).toHaveLength(6);
    expect(parseBullets(undefined)).toEqual([]);
  });
});
