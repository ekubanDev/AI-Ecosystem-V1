import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkProdConfig, parseEnv } from "../../scripts/check-prod.mjs";

const good = {
  compose: { APP_DOMAIN: "app.mybusiness.com", MONGO_PASSWORD: "a".repeat(8) + "0123456789abcdef0123456789abcdef" },
  backend: {
    NODE_ENV: "production", TRUST_PROXY: "1", MONGO_AUTO_INDEX: "true", CLIENT_URL: "https://app.mybusiness.com", COOKIE_SAMESITE: "lax",
    JWT_ACCESS_SECRET: "f".repeat(64), JWT_REFRESH_SECRET: "e".repeat(64), RATE_LIMIT_ENABLED: "true", REGISTRATION_ENABLED: "false", PRIVACY_OPERATOR_NAME: "My Business Ltd", PRIVACY_CONTACT_EMAIL: "privacy@mybusiness.com",
    OPENAI_API_KEY: "k", SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "k", GMAIL_USER: "a@b.co", GMAIL_APP_PASSWORD: "p", EMAIL_FROM: "X <no-reply@mybusiness.com>",
    AI_PRICE_INPUT_PER_MTOK: "0.4", AI_PRICE_OUTPUT_PER_MTOK: "1.6",
  },
};
const withBackend = (o) => ({ compose: good.compose, backend: { ...good.backend, ...o } });
const withCompose = (o) => ({ compose: { ...good.compose, ...o }, backend: good.backend });
const has = (res, re) => res.errors.some((e) => re.test(e)) || res.warnings.some((e) => re.test(e));

describe("production config check", () => {
  it("accepts a correct configuration without errors or warnings", () => {
    assert.deepEqual(checkProdConfig(good), { errors: [], warnings: [] });
  });

  it("rejects the example files as they ship (placeholders everywhere)", () => {
    const res = checkProdConfig({
      compose: parseEnv("APP_DOMAIN=app.example.com\nMONGO_PASSWORD=change-me-generate-with-openssl-rand-hex-24"),
      backend: parseEnv("NODE_ENV=production\nTRUST_PROXY=1\nMONGO_AUTO_INDEX=true\nCLIENT_URL=https://app.example.com\nJWT_ACCESS_SECRET=\nJWT_REFRESH_SECRET="),
    });
    assert.ok(has(res, /APP_DOMAIN is still the example/));
    assert.ok(has(res, /MONGO_PASSWORD/));
    assert.ok(has(res, /JWT_ACCESS_SECRET/));
  });

  it("catches the settings that fail quietly in production", () => {
    assert.ok(has(checkProdConfig(withBackend({ MONGO_AUTO_INDEX: "false" })), /MONGO_AUTO_INDEX must be true/));
    assert.ok(has(checkProdConfig(withBackend({ MONGO_AUTO_INDEX: undefined })), /MONGO_AUTO_INDEX must be true/));
    assert.ok(has(checkProdConfig(withBackend({ TRUST_PROXY: "false" })), /TRUST_PROXY/));
    assert.ok(has(checkProdConfig(withBackend({ NODE_ENV: "development" })), /NODE_ENV/));
    assert.ok(has(checkProdConfig(withBackend({ RATE_LIMIT_ENABLED: "false" })), /RATE_LIMIT_ENABLED/));
    assert.ok(has(checkProdConfig(withBackend({ REGISTRATION_ENABLED: "true" })), /REGISTRATION_ENABLED must be false/));
    assert.ok(has(checkProdConfig(withBackend({ REGISTRATION_ENABLED: undefined })), /REGISTRATION_ENABLED must be false/));
  });

  it("requires a real responsible party and contact address for the privacy notice", () => {
    assert.ok(has(checkProdConfig(withBackend({ PRIVACY_OPERATOR_NAME: "" })), /PRIVACY_OPERATOR_NAME/));
    assert.ok(has(checkProdConfig(withBackend({ PRIVACY_OPERATOR_NAME: "Your business name" })), /PRIVACY_OPERATOR_NAME/));
    assert.ok(has(checkProdConfig(withBackend({ PRIVACY_CONTACT_EMAIL: "" })), /PRIVACY_CONTACT_EMAIL/));
    assert.ok(has(checkProdConfig(withBackend({ PRIVACY_CONTACT_EMAIL: "privacy@example.com" })), /PRIVACY_CONTACT_EMAIL/));
    assert.ok(has(checkProdConfig(withBackend({ PRIVACY_CONTACT_EMAIL: "not an email" })), /PRIVACY_CONTACT_EMAIL/));
  });

  it("requires CLIENT_URL to match the domain exactly, over https", () => {
    assert.ok(has(checkProdConfig(withBackend({ CLIENT_URL: "http://app.mybusiness.com" })), /CLIENT_URL must be exactly https:\/\/app\.mybusiness\.com/));
    assert.ok(has(checkProdConfig(withBackend({ CLIENT_URL: "https://app.mybusiness.com/" })), /CLIENT_URL/));
  });

  it("requires strong, distinct JWT secrets", () => {
    assert.ok(has(checkProdConfig(withBackend({ JWT_ACCESS_SECRET: "short" })), /JWT_ACCESS_SECRET/));
    assert.ok(has(checkProdConfig(withBackend({ JWT_REFRESH_SECRET: good.backend.JWT_ACCESS_SECRET })), /must differ/));
  });

  it("checks the database password and the domain format", () => {
    assert.ok(has(checkProdConfig(withCompose({ MONGO_PASSWORD: "short" })), /MONGO_PASSWORD/));
    assert.ok(has(checkProdConfig(withCompose({ MONGO_PASSWORD: "p@ss/" + "x".repeat(30) })), /break the MongoDB connection string/));
    assert.ok(has(checkProdConfig(withCompose({ APP_DOMAIN: "https://app.mybusiness.com" })), /bare host name/));
    assert.ok(has(checkProdConfig(withCompose({ APP_DOMAIN: "localhost" })), /local rehearsal/));
  });

  it("warns about the per-token AI price mistake and about missing email, search and AI keys", () => {
    assert.ok(has(checkProdConfig(withBackend({ AI_PRICE_INPUT_PER_MTOK: "0.0000015" })), /per-TOKEN price/));
    const bare = checkProdConfig(withBackend({ GMAIL_USER: "", OPENAI_API_KEY: "", SEARCH_PROVIDER: "none", SEARCH_API_KEY: "" }));
    assert.equal(bare.errors.length, 0);
    assert.ok(has(bare, /Gmail/) && has(bare, /OPENAI_API_KEY/) && has(bare, /knowledge-only/));
    assert.ok(has(checkProdConfig(withBackend({ SEARCH_API_KEY: "" })), /SEARCH_API_KEY is empty/));
  });

  it("parses env files: comments, quotes and spaces around =", () => {
    assert.deepEqual(parseEnv("# c\nA=1\nB = 'two words'\n  C=\"x\"\nbad line\n#D=4"), { A: "1", B: "two words", C: "x" });
  });
});
