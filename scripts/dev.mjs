#!/usr/bin/env node
// Local development helper (cross-platform; Node >= 22, no dependencies).
//
//   node scripts/dev.mjs setup [--owner you@example.com]   install deps, create backend/.env, make sure MongoDB is up, seed an OWNER
//   node scripts/dev.mjs start                              run API (+ in-process worker) and frontend dev server together
//   node scripts/dev.mjs test [--e2e]                       run backend + frontend tests (and the browser suite with --e2e)
//
// Also available as `npm run setup|dev|test` from the repository root. It never overwrites an existing backend/.env and
// never prints or stores API keys: put OPENAI_API_KEY, SEARCH_*, GMAIL_* in backend/.env yourself.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "frontend");
const ENV_FILE = path.join(BACKEND, ".env");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const say = (m) => console.log(`\x1b[36m▸\x1b[0m ${m}`);
const warn = (m) => console.warn(`\x1b[33m!\x1b[0m ${m}`);
const die = (m) => {
  console.error(`\x1b[31m✗ ${m}\x1b[0m`);
  process.exit(1);
};

const run = (cmd, args, cwd, opts = {}) => spawnSync(cmd, args, { cwd, stdio: "inherit", shell: isWin, ...opts });

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );
}

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) die(`Node 22 or newer (try: nvm install 22) is required (you have ${process.versions.node}).`);
}

function createEnvFile() {
  if (fs.existsSync(ENV_FILE)) {
    say("backend/.env already exists — leaving it untouched.");
    return;
  }
  const secret = () => crypto.randomBytes(48).toString("hex");
  const text = fs
    .readFileSync(path.join(BACKEND, ".env.example"), "utf8")
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${secret()}`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${secret()}`);
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
  say("Created backend/.env with freshly generated JWT secrets (git-ignored).");
  warn("Add OPENAI_API_KEY (and SEARCH_PROVIDER + SEARCH_API_KEY, GMAIL_USER + GMAIL_APP_PASSWORD) to it yourself when you want live agents/email.");
}

const canConnect = (host, port, ms = 1500) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
  });

async function ensureMongo() {
  const uri = readEnv().MONGODB_URI || "mongodb://localhost:27017/ai_business_factory";
  let host = "localhost";
  let port = 27017;
  try {
    const u = new URL(uri);
    host = u.hostname;
    port = Number(u.port || 27017);
  } catch {
    warn(`Could not parse MONGODB_URI (${uri}); assuming localhost:27017.`);
  }
  if (await canConnect(host, port)) return say(`MongoDB is reachable at ${host}:${port}.`);

  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", shell: isWin });
  if (!local || docker.status !== 0) {
    die(`MongoDB is not reachable at ${host}:${port}.\n  Start MongoDB 6+ yourself (or install Docker Desktop) and set MONGODB_URI in backend/.env, then re-run.`);
  }
  say("Starting MongoDB 7 in Docker (container 'abf-mongo', data in volume 'abf-mongo-data')…");
  const existing = spawnSync("docker", ["ps", "-a", "--filter", "name=^abf-mongo$", "--format", "{{.Names}}"], { encoding: "utf8", shell: isWin }).stdout.trim();
  const started = existing ? run("docker", ["start", "abf-mongo"], ROOT) : run("docker", ["run", "-d", "--name", "abf-mongo", "-p", `${port}:27017`, "-v", "abf-mongo-data:/data/db", "mongo:7"], ROOT);
  if (started.status !== 0) die("Could not start the MongoDB container.");
  for (let i = 0; i < 40; i++) {
    if (await canConnect(host, port)) return say("MongoDB is up.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  die("MongoDB did not become reachable within 40 seconds.");
}

function seedOwner(email) {
  const password = process.env.SEED_OWNER_PASSWORD || crypto.randomBytes(12).toString("base64url") + "!9";
  const generated = !process.env.SEED_OWNER_PASSWORD;
  say(`Seeding OWNER ${email}…`);
  const r = run(npm, ["run", "seed"], BACKEND, { env: { ...process.env, SEED_OWNER_EMAIL: email, SEED_OWNER_PASSWORD: password } });
  if (r.status !== 0) die("Seeding failed (see output above).");
  if (generated) {
    console.log(`\n  Log in at http://localhost:3000 with:\n    email:    ${email}\n    password: ${password}\n  (shown once — change it via "Forgot password" or re-run setup with SEED_OWNER_PASSWORD set)\n`);
  }
}

async function setup(args) {
  checkNode();
  const i = args.indexOf("--owner");
  const owner = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && (!owner || !/^\S+@\S+\.\S+$/.test(owner))) die("--owner needs an email address, e.g. --owner you@example.com");

  say("Installing backend dependencies…");
  if (run(npm, [fs.existsSync(path.join(BACKEND, "package-lock.json")) ? "ci" : "install"], BACKEND).status !== 0) die("npm install failed in backend/.");
  say("Installing frontend dependencies…");
  if (run(npm, [fs.existsSync(path.join(FRONTEND, "package-lock.json")) ? "ci" : "install"], FRONTEND).status !== 0) die("npm install failed in frontend/.");
  createEnvFile();
  await ensureMongo();
  if (owner) seedOwner(owner);
  else say("No owner seeded. Create one with:  node scripts/dev.mjs setup --owner you@example.com  (or just register in the UI: the first account becomes OWNER).");
  say("Setup done. Start everything with:  npm run dev");
}

function start() {
  checkNode();
  if (!fs.existsSync(ENV_FILE)) die("backend/.env is missing — run `node scripts/dev.mjs setup` first.");
  if (!fs.existsSync(path.join(FRONTEND, "node_modules"))) die("Dependencies are not installed — run `node scripts/dev.mjs setup` first.");
  const env = readEnv();
  if (!env.OPENAI_API_KEY) warn("OPENAI_API_KEY is not set in backend/.env: agent tasks will fail until it is.");
  if ((env.SEARCH_PROVIDER || "none") === "none") warn("SEARCH_PROVIDER is 'none': agents cannot gather web sources (discovery will be knowledge-only).");

  const children = [];
  const launch = (label, cwd, color) => {
    // detached (POSIX): each dev server gets its own process group so stop() can kill npm *and* the node/vite processes it spawns.
    const child = spawn(npm, ["run", "dev"], { cwd, shell: isWin, detached: !isWin, stdio: ["ignore", "pipe", "pipe"] });
    const tag = `\x1b[${color}m${label}\x1b[0m `;
    const pipe = (stream, out) => {
      let buf = "";
      stream.on("data", (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) out.write(`${tag}${l}\n`);
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(`${tag}exited with code ${code}; stopping.`);
        stop(code ?? 1);
      }
    });
    children.push(child);
  };
  let stopping = false;
  const stop = (code = 0) => {
    stopping = true;
    for (const c of children) {
      if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
      else {
        try {
          process.kill(-c.pid, "SIGTERM"); // negative pid = the whole process group
        } catch {
          c.kill("SIGTERM");
        }
      }
    }
    setTimeout(() => process.exit(code), 500);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  launch("api", BACKEND, "35");
  launch("web", FRONTEND, "32");
  say("API on http://localhost:3001, app on http://localhost:3000 (Ctrl+C stops both).");
}

function test(args) {
  checkNode();
  const steps = [["backend", BACKEND], ["frontend", FRONTEND]];
  for (const [name, cwd] of steps) {
    say(`Running ${name} tests…`);
    if (run(npm, ["test"], cwd).status !== 0) die(`${name} tests failed.`);
  }
  if (args.includes("--e2e")) {
    say("Building the frontend and running the browser suite (needs: cd e2e && npm ci && npx playwright install chromium)…");
    if (run(npm, ["run", "build"], FRONTEND).status !== 0) die("frontend build failed.");
    if (run(npm, ["test"], path.join(ROOT, "e2e")).status !== 0) die("browser suite failed.");
  }
  say("All tests passed.");
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "setup") await setup(args);
else if (cmd === "start") start();
else if (cmd === "test") test(args);
else {
  console.log("Usage: node scripts/dev.mjs <setup [--owner email] | start | test [--e2e]>");
  process.exit(cmd ? 1 : 0);
}
