#!/usr/bin/env node
// Pre-flight check for a production deploy: `node scripts/check-prod.mjs` (run it before every `docker compose up`).
// It exits non-zero on any ERROR. Each rule below exists because getting it wrong fails quietly or unsafely in production.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const PLACEHOLDER = /change-?me|example\.com|^$|your[-_ ]|xxx/i;

/** @returns {{errors: string[], warnings: string[]}} */
export function checkProdConfig({ compose = {}, backend = {} }) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // docker/.env
  const domain = compose.APP_DOMAIN ?? "";
  if (!domain) err("docker/.env: APP_DOMAIN is not set.");
  else if (/[/\s:]/.test(domain)) err("docker/.env: APP_DOMAIN must be a bare host name (no https://, path, port or spaces).");
  else if (domain === "localhost") warn("APP_DOMAIN is localhost: fine for a local rehearsal (Caddy uses a self-signed certificate), but not for the public.");
  else if (/(^|\.)example\.(com|org|net)$/.test(domain)) err("docker/.env: APP_DOMAIN is still the example placeholder.");
  const pw = compose.MONGO_PASSWORD ?? "";
  if (pw.length < 24 || PLACEHOLDER.test(pw)) err("docker/.env: MONGO_PASSWORD is missing, short (< 24) or a placeholder. Use: openssl rand -hex 24");
  if (/[@:/?#%\s]/.test(pw)) err("docker/.env: MONGO_PASSWORD contains characters that break the MongoDB connection string. Use hex (openssl rand -hex 24).");

  // backend/.env.production
  if (backend.NODE_ENV !== "production") err("backend: NODE_ENV must be production (secure cookies, no auto-created indexes, no dev behaviour).");
  if (!/^(true|[1-9]\d*)$/.test(backend.TRUST_PROXY ?? "")) err("backend: TRUST_PROXY must be 1 behind Caddy, otherwise rate limits see one shared proxy IP and throttle everyone together.");
  if (backend.MONGO_AUTO_INDEX !== "true") err("backend: MONGO_AUTO_INDEX must be true. Production defaults it off, which silently drops the unique indexes (slugs, one lead per email).");
  if (backend.REGISTRATION_ENABLED !== "false") err("backend: REGISTRATION_ENABLED must be false in production, or anyone can create an account and read your research. Create the owner with the seed script instead.");
  if (backend.RATE_LIMIT_ENABLED === "false") err("backend: RATE_LIMIT_ENABLED=false removes the protection on login and on the public lead form.");
  if (domain && backend.CLIENT_URL !== `https://${domain}`) err(`backend: CLIENT_URL must be exactly https://${domain} (CORS, the refresh-cookie Origin check and email links all use it).`);
  const a = backend.JWT_ACCESS_SECRET ?? "";
  const r = backend.JWT_REFRESH_SECRET ?? "";
  for (const [name, v] of [["JWT_ACCESS_SECRET", a], ["JWT_REFRESH_SECRET", r]]) if (v.length < 32 || PLACEHOLDER.test(v)) err(`backend: ${name} is missing, shorter than 32 characters or a placeholder. Use: openssl rand -hex 48`);
  if (a && a === r) err("backend: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.");
  if (backend.COOKIE_SAMESITE === "none") warn("backend: COOKIE_SAMESITE=none is only needed for cross-site setups; the single-origin deploy should use lax.");

  for (const k of ["AI_PRICE_INPUT_PER_MTOK", "AI_PRICE_OUTPUT_PER_MTOK"]) {
    const v = backend[k];
    if (v && Number(v) > 0 && Number(v) < 0.001) warn(`backend: ${k}=${v} looks like a per-TOKEN price. It is USD per MILLION tokens (e.g. 0.4), so costs would be recorded about a million times too small.`);
  }
  if (!backend.OPENAI_API_KEY) warn("backend: OPENAI_API_KEY is empty: agents cannot run.");
  if ((backend.SEARCH_PROVIDER ?? "none") !== "none" && !backend.SEARCH_API_KEY) err("backend: SEARCH_PROVIDER is set but SEARCH_API_KEY is empty.");
  if ((backend.SEARCH_PROVIDER ?? "none") === "none") warn("backend: SEARCH_PROVIDER=none: discovery runs in knowledge-only mode (everything inferred).");
  if (!backend.GMAIL_USER || !backend.GMAIL_APP_PASSWORD) warn("backend: no Gmail credentials: verification and password-reset emails will not be delivered.");
  if (/example\.com/.test(backend.EMAIL_FROM ?? "")) warn("backend: EMAIL_FROM still uses example.com.");
  return { errors, warnings };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (rel) => {
    try {
      return parseEnv(fs.readFileSync(path.join(root, rel), "utf8"));
    } catch {
      console.error(`ERROR  ${rel} not found: copy the matching *.example file and fill it in.`);
      process.exit(1);
    }
  };
  const { errors, warnings } = checkProdConfig({ compose: read("docker/.env"), backend: read("backend/.env.production") });
  for (const w of warnings) console.log(`WARN   ${w}`);
  for (const e of errors) console.log(`ERROR  ${e}`);
  console.log(errors.length ? `\n${errors.length} error(s): fix them before deploying.` : `\nConfig OK${warnings.length ? ` (${warnings.length} warning(s) above)` : ""}.`);
  process.exit(errors.length ? 1 : 0);
}
