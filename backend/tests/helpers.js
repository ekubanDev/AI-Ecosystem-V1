import crypto from "node:crypto";
import request from "supertest";

// Environment must be set before any app module reads config.
const dbName = `abf_test_${process.pid}_${crypto.randomBytes(3).toString("hex")}`;
const base = process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017";
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  MONGODB_URI: `${base.replace(/\/$/, "")}/${dbName}`,
  JWT_ACCESS_SECRET: "test-access-secret-test-access-secret-1234",
  JWT_REFRESH_SECRET: "test-refresh-secret-test-refresh-secret-5678",
  BCRYPT_ROUNDS: "4",
  RATE_LIMIT_ENABLED: "false",
  RETRY_BASE_DELAY_MS: "0",
  MAX_AGENT_RETRIES: "3",
  AGENT_TIMEOUT_MS: "20000",
  SEARCH_MODE: process.env.TEST_SEARCH_MODE ?? "text",
  CLIENT_URL: "http://localhost:3000",
  OPENAI_API_KEY: "",
});

const { default: mongoose } = await import("mongoose");
const { loadEnv } = await import("../config/env.js");
const { connectDb } = await import("../config/db.js");
const { createApp } = await import("../app.js");
const { createContainer } = await import("../container.js");
const models = await import("../models/index.js");

export { models, mongoose };

// ---- fakes ----------------------------------------------------------------------------------------------------

const URLS = ["https://acme-procure.example/pricing", "https://ledgerlite.example/", "https://supplier-hub.example/about", "https://reviews.example/procurement-tools"];

/** Scripted stand-in for the model: dispatches on which agent/phase the prompt belongs to. Records every call. */
export function createFakeProvider() {
  const calls = [];
  let failures = [];
  const provider = {
    name: "fake",
    calls,
    /** Make the next `n` calls fail with the error returned by `make()`. */
    failNext(n, make) {
      failures = Array.from({ length: n }, () => make);
    },
    responder: null, // optional override: (label, prompt) => object | string | undefined
    delayMs: 0,
    async complete({ label, prompt }) {
      calls.push({ label, prompt });
      if (provider.delayMs) await new Promise((r) => setTimeout(r, provider.delayMs));
      if (failures.length) throw failures.shift()();
      const custom = provider.responder?.(label, prompt);
      const out = custom ?? defaultResponse(label, prompt);
      return { text: typeof out === "string" ? out : JSON.stringify(out), model: "fake-model", usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
  return provider;
}

function defaultResponse(label, prompt) {
  const wantsQueries = /search queries/i.test(prompt);
  if (wantsQueries) return { queries: [`${label} query one`, `${label} query two`] };
  switch (label) {
    case "Opportunity Scout":
      return {
        opportunities: [
          {
            name: "Procure Pilot", category: "B2B Software", description: "Supplier price intelligence for SMEs.", customer: "SME distributors",
            problem: "Hard to compare supplier prices.", observedBusinessModel: { type: "SUBSCRIPTION", revenueMechanism: "Monthly plan" },
            demandSignals: [{ observation: "Buyers ask for price comparison tools", strength: "STRONG", sourceRefs: [1] }],
            initialEvidence: [
              { claim: "Offers monthly subscription pricing", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [1] },
              { claim: "Claims 10k suppliers", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [99] },
            ],
            sourceRefs: [1],
          },
          {
            name: "Ledger Lite", category: "B2B Software", description: "Simple bookkeeping automation.", customer: "Micro-businesses",
            problem: "Bookkeeping is delayed.", observedBusinessModel: { type: "SAAS", revenueMechanism: "Per-seat" },
            demandSignals: [], initialEvidence: [{ claim: "Lists a free tier", evidenceType: "SUPPORTED", confidence: "MEDIUM", sourceRefs: [2] }], sourceRefs: [2],
          },
          {
            name: "Ghost Co", category: "B2B Software", description: "Cites nothing real.", customer: "Nobody", problem: "None",
            observedBusinessModel: { type: "OTHER", revenueMechanism: "" }, demandSignals: [], initialEvidence: [], sourceRefs: [77],
          },
        ],
        assumptions: [], uncertainties: [],
      };
    case "Research Agent":
      return {
        marketEvidence: [{ claim: "SMEs compare suppliers manually", evidenceType: "SUPPORTED", confidence: "MEDIUM", sourceRefs: [1] }],
        customerEvidence: [{ claim: "Buyers complain about opaque pricing", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [2] }],
        pricingEvidence: [{ claim: "Plans start at $10/month", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [1] }],
        competitorEvidence: [{ claim: "Acme Procure is a direct alternative", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [1] }],
        businessModelEvidence: [{ claim: "Revenue is subscription based", evidenceType: "VERIFIED", confidence: "HIGH", sourceRefs: [99] }],
        competitorLeads: ["Acme Procure", "Supplier Hub"],
        pricing: { minimum: 10, maximum: 50, currency: "usd", sourceRefs: [1] },
        uncertainties: ["Traction is unknown"],
      };
    case "Competitor Agent":
      return {
        competitors: [
          { name: "Acme Procure", website: "https://acme-procure.example", customerSegment: "SMEs", geography: "Global", products: ["Price comparison"], pricing: "From $10/mo", businessModel: "SUBSCRIPTION", acquisitionChannels: ["SEO"], strengths: ["Brand"], weaknesses: ["No local suppliers"], customerComplaints: ["Slow support"], differentiationOpportunities: ["Local supplier data"], evidenceType: "VERIFIED", sourceRefs: [1] },
          { name: "Supplier Hub", website: "https://supplier-hub.example", customerSegment: null, geography: null, products: [], pricing: "$5/mo", businessModel: null, acquisitionChannels: [], strengths: [], weaknesses: [], customerComplaints: ["Made up complaint"], differentiationOpportunities: [], evidenceType: "VERIFIED", sourceRefs: [55] },
        ],
        uncertainties: [],
      };
    case "Business Model Agent": {
      const f = (value, evidenceType, evidenceRefs) => ({ value, evidenceType, evidenceRefs });
      return {
        customer: f("SME distributors", "SUPPORTED", [1]), problem: f("Supplier discovery", "SUPPORTED", [1]), valueProposition: f("Compare prices fast", "INFERRED", []),
        product: f("Price intelligence dashboard", "SUPPORTED", [2]), acquisition: f("SEO and outbound", "VERIFIED", [999]), conversion: f("Free trial", "ASSUMED", []),
        pricing: f("Monthly subscription", "VERIFIED", [3]), delivery: f("Web app", "INFERRED", []), retention: f("Alerts and reports", "INFERRED", []),
        upsell: f("Lead generation", "UNKNOWN", []), referral: f("Unknown", "UNKNOWN", []),
        revenueModel: "SUBSCRIPTION", operationalDependencies: ["Supplier data"], technologyDependencies: ["Scrapers"], confidence: "HIGH", uncertainties: [], assumptions: ["Suppliers will share prices"],
      };
    }
    case "Opportunity Analyst":
      return {
        assessment: {
          demand: { value: "MODERATE", confidence: "HIGH" }, competition: { value: "MODERATE", confidence: "HIGH" },
          monetization: { value: "POSSIBLE", confidence: "HIGH" }, recurringRevenuePotential: { value: "HIGH", confidence: "HIGH" },
          acquisitionDifficulty: "MEDIUM", technicalComplexity: "MEDIUM", operationalComplexity: "MEDIUM", capitalRequirement: "LOW_TO_MEDIUM",
          regulatoryConsiderations: [], localization: { summary: "Needs local suppliers and GHS pricing", confidence: "MEDIUM" },
          differentiationOpportunities: [{ idea: "Local supplier database", rationale: "Incumbents lack it", geography: "Ghana" }],
          risks: [{ category: "market", description: "Suppliers may not share prices", severity: "HIGH" }],
          economics: { estimatedCAC: 50, estimatedLTV: 600, estimatedARPU: 25, estimatedMargin: 0.7, currency: "USD", confidence: "HIGH", basis: "Competitor price points and assumed 24-month retention" },
          hypotheses: ["SMEs will pay for supplier price intelligence"],
          validationRecommendation: { objective: "Test paid demand", method: "Manual intelligence reports for 10 SMEs", budget: 200, successCriteria: "3 paid pilots" },
        },
        uncertainties: [], assumptions: [],
      };
    default:
      return {};
  }
}

export const fakeSearchProvider = {
  name: "fake-search",
  async search() {
    return URLS.map((url, i) => ({ title: `Result ${i + 1}`, url, snippet: `Snippet for result ${i + 1}: pricing, customers and reviews.` }));
  },
};

export const fakeFetcher = async (url) => ({
  finalUrl: url, contentType: "text/html",
  body: `<html><head><title>Page at ${new URL(url).hostname}</title></head><body><h1>Pricing</h1><p>Plans from $10 per month for SMEs.</p><script>x()</script></body></html>`,
});

/**
 * Real MongoDB guarantees single-document atomic conditional updates. Some MongoDB-compatible servers used for quick local
 * runs do not, so concurrency-race tests skip themselves (with a reason) instead of reporting a false failure there.
 */
async function probeAtomicUpdates() {
  const col = mongoose.connection.collection("_atomic_probe");
  try {
    // A non-atomic emulator can win one round by luck, so require exactly one winner in every one of several rounds.
    for (let round = 0; round < 8; round++) {
      const { insertedId } = await col.insertOne({ v: 0 });
      const rs = await Promise.all(Array.from({ length: 12 }, () => col.findOneAndUpdate({ _id: insertedId, v: 0 }, { $inc: { v: 1 } })));
      if (rs.filter(Boolean).length !== 1) return false;
    }
    return true;
  } finally {
    await col.drop().catch(() => {});
  }
}

/** Some MongoDB-compatible servers only evaluate the first $sum in a $group; real MongoDB evaluates all of them. */
async function probeMultipleAccumulators() {
  const col = mongoose.connection.collection("_accumulator_probe");
  await col.insertMany([{ k: 1, a: 2, b: 3 }, { k: 1, a: 2, b: 3 }]);
  const [row] = await col.aggregate([{ $group: { _id: "$k", n: { $sum: 1 }, a: { $sum: "$a" }, b: { $sum: "$b" } } }]).toArray();
  await col.drop().catch(() => {});
  return row.n === 2 && row.a === 4 && row.b === 6;
}

// ---- app harness ----------------------------------------------------------------------------------------------

export async function setup(overrides = {}) {
  const config = loadEnv(process.env);
  await connectDb(config);
  const emails = [];
  const provider = overrides.aiProvider !== undefined ? overrides.aiProvider : createFakeProvider();
  const container = createContainer(config, {
    aiProvider: provider,
    searchProvider: fakeSearchProvider,
    fetcher: fakeFetcher,
    emailTransport: { send: async (m) => emails.push(m) },
    ...overrides,
  });
  const app = createApp(container);
  const atomic = await probeAtomicUpdates();
  const accumulators = await probeMultipleAccumulators();
  return {
    app, container, config, emails, provider, atomic, accumulators,
    http: request(app),
    async cleanup() {
      await container.worker.stop();
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

export const tokenFromEmail = (emails, to) => {
  const msg = [...emails].reverse().find((m) => m.to === to);
  return msg && new URL(/https?:\/\/\S+/.exec(msg.text)[0]).searchParams.get("token");
};

let n = 0;
/** Registers, verifies and logs in a user; the role is set directly in the database (public registration only yields VIEWER/first-OWNER). */
export async function makeUser(ctx, role = "ANALYST", { name = "Test User" } = {}) {
  const email = `user${++n}_${crypto.randomBytes(3).toString("hex")}@example.com`;
  const password = "StrongPassword123!";
  await ctx.http.post("/api/auth/register").send({ name, email, password }).expect(201);
  await ctx.http.get("/api/auth/verify-email").query({ token: tokenFromEmail(ctx.emails, email) }).expect(200);
  await models.User.updateOne({ email }, { $set: { role } });
  const res = await ctx.http.post("/api/auth/login").send({ email, password }).expect(200);
  return { email, password, token: res.body.data.accessToken, id: res.body.data.user.id, role, cookies: res.headers["set-cookie"] };
}

export const as = (ctx, user) => ({
  get: (u) => ctx.http.get(u).set("Authorization", `Bearer ${user.token}`),
  post: (u) => ctx.http.post(u).set("Authorization", `Bearer ${user.token}`),
  patch: (u) => ctx.http.patch(u).set("Authorization", `Bearer ${user.token}`),
  delete: (u) => ctx.http.delete(u).set("Authorization", `Bearer ${user.token}`),
});

/** An opportunity in AWAITING_APPROVAL, created through the API then moved directly in the database. */
export async function makeOpportunity(ctx, user, overrides = {}, status = "DISCOVERED") {
  const res = await as(ctx, user).post("/api/opportunities").send({ name: `Opp ${++n} ${crypto.randomBytes(2).toString("hex")}`, category: "B2B Software", ...overrides }).expect(201);
  if (status !== "DISCOVERED") await models.Opportunity.updateOne({ _id: res.body.data.id }, { $set: { status } });
  return res.body.data;
}
