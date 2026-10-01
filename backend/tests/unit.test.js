import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "./helpers.js";
import { capConfidence, resolveEvidence } from "../agents/agentUtils.js";
import { loadEnv } from "../config/env.js";
import { OPPORTUNITY_FLOW, assertTransition, canTransition, sourcesFor } from "../models/stateMachine.js";
import { assertNoOperators } from "../utils/sanitize.js";
import { isRetryable, AppError } from "../utils/errors.js";
import { htmlToText } from "../utils/html.js";
import { isPrivateAddress } from "../utils/net.js";
import { assertPublicUrl, safeFetchText } from "../utils/safeFetch.js";
import { jaccard, nameTokens, normalizeUrl, slugify } from "../utils/text.js";
import { findDuplicate } from "../services/opportunityService.js";
import { nameKey } from "../utils/text.js";

describe("opportunity state machine", () => {
  it("allows the forward path one step at a time", () => {
    for (let i = 0; i < OPPORTUNITY_FLOW.length - 1; i++) assert.ok(canTransition(OPPORTUNITY_FLOW[i], OPPORTUNITY_FLOW[i + 1]));
  });
  it("forbids skipping and going backwards", () => {
    assert.equal(canTransition("DISCOVERED", "APPROVED"), false);
    assert.equal(canTransition("AWAITING_APPROVAL", "DISCOVERED"), false);
    assert.throws(() => assertTransition("VALIDATED", "APPROVED"), (e) => e.code === "INVALID_STATE_TRANSITION");
  });
  it("allows pause/reject from any active stage and treats REJECTED as terminal", () => {
    for (const s of OPPORTUNITY_FLOW) {
      assert.ok(canTransition(s, "PAUSED"));
      assert.ok(canTransition(s, "REJECTED"));
    }
    assert.ok(canTransition("PAUSED", "REJECTED"));
    for (const s of OPPORTUNITY_FLOW) assert.equal(canTransition("REJECTED", s), false);
  });
  it("sourcesFor(APPROVED) is only AWAITING_APPROVAL (and PAUSED, which resumes)", () => {
    assert.deepEqual(sourcesFor("APPROVED").sort(), ["AWAITING_APPROVAL", "PAUSED"]);
  });
});

describe("text utils", () => {
  it("normalizes URLs for dedupe", () => {
    assert.equal(normalizeUrl("HTTPS://www.Example.com:443/path/?utm_source=x&b=2&a=1#frag"), "https://example.com/path?a=1&b=2");
    assert.equal(normalizeUrl("https://example.com/"), "https://example.com");
    assert.throws(() => normalizeUrl("ftp://example.com"));
  });
  it("slugifies", () => assert.equal(slugify("  AI Procurement & Intelligence! "), "ai-procurement-and-intelligence"));
  it("detects duplicate names by slug, key and token overlap", () => {
    const index = [{ id: 1, slug: "procure-pilot", key: nameKey("Procure Pilot"), tokens: nameTokens("Procure Pilot") }];
    assert.ok(findDuplicate("Procure Pilot", index));
    assert.ok(findDuplicate("procure-pilot", index));
    assert.ok(findDuplicate("The Procure Pilot AI", index));
    assert.equal(findDuplicate("Ledger Lite", index), null);
    assert.equal(jaccard(new Set(["a"]), new Set()), 0);
  });
  it("converts html to text without scripts", () => {
    const { title, text } = htmlToText("<html><title>T &amp; U</title><body><script>bad()</script><p>Hello&nbsp;world</p></body></html>");
    assert.equal(title, "T & U");
    assert.match(text, /Hello world/);
    assert.doesNotMatch(text, /bad/);
  });
});

describe("input sanitization", () => {
  it("rejects operator keys anywhere in a payload", () => {
    assert.throws(() => assertNoOperators({ email: { $gt: "" } }), (e) => e.code === "VALIDATION_ERROR");
    assert.throws(() => assertNoOperators({ a: [{ "b.c": 1 }] }), (e) => e.code === "VALIDATION_ERROR");
    assert.doesNotThrow(() => assertNoOperators({ a: [{ b: "$5.00" }] }));
  });
});

describe("SSRF protection", () => {
  it("flags private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "not-an-ip"]) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
  });
  it("refuses non-http schemes, credentials and hosts resolving to private IPs", async () => {
    await assert.rejects(assertPublicUrl("file:///etc/passwd"), (e) => e.code === "VALIDATION_ERROR");
    await assert.rejects(assertPublicUrl("http://user:pw@example.com"), (e) => e.code === "VALIDATION_ERROR");
    await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data"), (e) => e.code === "FORBIDDEN");
    await assert.rejects(assertPublicUrl("http://internal.test/", async () => [{ address: "10.1.1.1" }]), (e) => e.code === "FORBIDDEN");
    await assert.doesNotReject(assertPublicUrl("http://ok.test/", async () => [{ address: "93.184.216.34" }]));
  });
  it("re-validates every redirect hop", async () => {
    const lookup = async (h) => [{ address: h === "evil.test" ? "10.0.0.1" : "93.184.216.34" }];
    const fetchImpl = async (u) =>
      new URL(u).hostname === "start.test"
        ? new Response(null, { status: 302, headers: { location: "http://evil.test/secret" } })
        : new Response("secret", { status: 200, headers: { "content-type": "text/plain" } });
    await assert.rejects(safeFetchText("http://start.test/", { lookup, fetchImpl }), (e) => e.code === "FORBIDDEN");
  });
  it("returns text for public pages and truncates at maxBytes", async () => {
    const lookup = async () => [{ address: "93.184.216.34" }];
    const fetchImpl = async () => new Response("x".repeat(5000), { status: 200, headers: { "content-type": "text/plain" } });
    const r = await safeFetchText("http://ok.test/", { lookup, fetchImpl, maxBytes: 1000 });
    assert.equal(r.body.length, 1000);
    const bin = async () => new Response("x", { status: 200, headers: { "content-type": "application/pdf" } });
    await assert.rejects(safeFetchText("http://ok.test/", { lookup, fetchImpl: bin }), (e) => e.code === "EXTERNAL_SERVICE_ERROR");
  });
});

describe("evidence integrity", () => {
  const refMap = new Map([[1, "src1"], [2, "src2"]]);
  it("downgrades sourced claims that cite no real source", () => {
    const [a, b, c] = resolveEvidence(
      [
        { claim: "a", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [1] },
        { claim: "b", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [99] },
        { claim: "c", evidenceType: "ESTIMATED", confidence: "HIGH", sourceRefs: [] },
      ],
      refMap
    );
    assert.deepEqual([a.evidenceType, a.confidence, a.sourceIds], ["VERIFIED", "HIGH", ["src1"]]);
    assert.deepEqual([b.evidenceType, b.confidence, b.downgraded], ["INFERRED", "MEDIUM", true]);
    assert.equal(c.confidence, "MEDIUM"); // estimates never reach HIGH
  });
  describe("grounding in the cited text", () => {
    const docs = [
      { ref: 1, text: "AkokoMarket an offline and online market place that connects smallholder farmers to guaranteed markets for their farm produce and inputs by dialing a USSD short code.", snippetOnly: true },
      { ref: 2, text: "The global subscription economy market is projected to grow from USD 557.8 billion in 2025 to USD 1,944.4 billion by 2035, with B2B accounting for 55.2% market share.", snippetOnly: false },
    ];
    const rm = new Map([[1, "src1"], [2, "src2"]]);
    const run = (claim, refs, type = "VERIFIED") => resolveEvidence([{ claim, evidenceType: type, confidence: "HIGH", sourceRefs: refs }], rm, docs)[0];

    it("downgrades a claim whose citation is about something else, and drops the misleading citation", () => {
      const r = run("Jowato SME Marketplace offers access to production centers, product development, and market linkages in Ghana.", [1]);
      assert.deepEqual([r.evidenceType, r.confidence, r.downgraded, r.sourceIds], ["INFERRED", "MEDIUM", true, []]);
    });
    it("keeps a claim the cited text supports", () => {
      const r = run("AkokoMarket connects smallholder farmers to guaranteed markets for their farm produce.", [1]);
      assert.deepEqual([r.evidenceType, r.downgraded, r.sourceIds], ["VERIFIED", false, ["src1"]]);
    });
    it("caps snippet-only evidence at MEDIUM but lets a fetched page reach HIGH", () => {
      assert.equal(run("AkokoMarket connects smallholder farmers to guaranteed markets for their farm produce.", [1]).confidence, "MEDIUM");
      assert.equal(run("The global subscription economy market is projected to grow to USD 1,944.4 billion by 2035.", [2]).confidence, "HIGH");
    });
    it("requires every figure in the claim to appear in the cited text", () => {
      assert.equal(run("The subscription economy market is projected to reach USD 999 billion by 2035.", [2]).evidenceType, "INFERRED");
    });
    it("does not judge when no documents are supplied (older call sites)", () => {
      const [r] = resolveEvidence([{ claim: "anything at all about unrelated topics here", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [1] }], rm);
      assert.equal(r.evidenceType, "VERIFIED");
    });
  });
  it("caps confidence", () => {
    assert.equal(capConfidence("HIGH", "LOW"), "LOW");
    assert.equal(capConfidence("UNKNOWN", "HIGH"), "UNKNOWN");
  });
});

describe("environment validation", () => {
  const ok = { JWT_ACCESS_SECRET: "a".repeat(32), JWT_REFRESH_SECRET: "b".repeat(32) };
  it("requires distinct 32+ char secrets", () => {
    assert.throws(() => loadEnv({}), /JWT_ACCESS_SECRET/);
    assert.throws(() => loadEnv({ ...ok, JWT_REFRESH_SECRET: ok.JWT_ACCESS_SECRET }), /must differ/);
    assert.equal(loadEnv(ok).PORT, 3001);
  });
});

describe("retry classification", () => {
  it("retries only explicitly transient errors", () => {
    assert.equal(isRetryable(new AppError("AGENT_ERROR", "x", { retryable: true })), true);
    assert.equal(isRetryable(Object.assign(new Error("x"), { code: "ECONNRESET" })), true);
    assert.equal(isRetryable(new AppError("VALIDATION_ERROR", "x")), false);
    assert.equal(isRetryable(new TypeError("bug")), false);
  });
});
