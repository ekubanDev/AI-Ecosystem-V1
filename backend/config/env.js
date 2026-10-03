import "dotenv/config";
import { z } from "zod";

const bool = (def) =>
  z
    .enum(["true", "false"])
    .default(def ? "true" : "false")
    .transform((v) => v === "true");

const num = (def) => z.coerce.number().default(def);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  TRUST_PROXY: z.string().default("false"),

  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/ai_business_factory"),
  MONGO_AUTO_INDEX: z.enum(["true", "false"]).optional(),
  SEARCH_MODE: z.enum(["text", "regex"]).default("text"),

  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  CLIENT_URL: z.string().default("http://localhost:3000"),
  EMAIL_FROM: z.string().default("AI Business Factory <no-reply@localhost>"),
  // Gmail SMTP (use an App Password, not the account password). Both or neither.
  GMAIL_USER: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  GMAIL_APP_PASSWORD: z.string().optional().or(z.literal("").transform(() => undefined)),

  RATE_LIMIT_ENABLED: bool(true),
  RATE_LIMIT_MAX: num(300),
  AUTH_RATE_LIMIT_MAX: num(20),
  VIEW_RATE_LIMIT_MAX: num(120), // public page-view pings per IP per 15 minutes
  LEAD_RATE_LIMIT_MAX: num(10), // public lead form submissions per IP per 15 minutes

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  // Optional pricing (USD per 1M tokens). Cost is recorded as null when unset rather than guessed.
  AI_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
  AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),

  SEARCH_PROVIDER: z.enum(["none", "tavily", "brave"]).default("none"),
  SEARCH_API_KEY: z.string().optional(),
  SEARCH_BLOCKED_DOMAINS: z.string().default("finance.yahoo.com,rocketreach.co"), // comma-separated; results from these hosts (and subdomains) are dropped

  RUN_WORKER: bool(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  WORKER_POLL_MS: z.coerce.number().int().min(50).default(2000),
  MAX_AGENT_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(5000),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180000),
  DISCOVERY_MAX_COUNT: z.coerce.number().int().min(1).default(50),

  // Experiments with a budget above this need OWNER/ADMIN to start (human approval gate).
  EXPERIMENT_APPROVAL_BUDGET_THRESHOLD: z.coerce.number().nonnegative().default(0),
});

export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n` +
        `Copy .env.example to .env and fill in the secrets ` +
        `(generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))").`
    );
  }
  const env = parsed.data;
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error("Invalid environment configuration: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.");
  }
  if (Boolean(env.GMAIL_USER) !== Boolean(env.GMAIL_APP_PASSWORD)) {
    throw new Error("Invalid environment configuration: set both GMAIL_USER and GMAIL_APP_PASSWORD, or neither.");
  }
  const isProd = env.NODE_ENV === "production";
  const origins = env.CLIENT_URL.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    ...env,
    isProd,
    isTest: env.NODE_ENV === "test",
    clientOrigins: origins,
    clientUrl: origins[0],
    trustProxy: env.TRUST_PROXY === "true" ? true : env.TRUST_PROXY === "false" ? false : Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY),
    gmailAppPassword: env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ""), // Google shows app passwords in groups of four; spaces are cosmetic
    autoIndex: env.MONGO_AUTO_INDEX ? env.MONGO_AUTO_INDEX === "true" : !isProd,
  };
}

let cached;
export const getConfig = () => (cached ??= loadEnv());
