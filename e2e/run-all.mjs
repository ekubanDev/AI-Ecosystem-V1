// Starts the test backend and the built frontend (vite preview, which proxies /api), runs the browser suite, tears everything down.
//   prerequisites: MongoDB reachable (TEST_MONGODB_URI, default mongodb://127.0.0.1:27017) and `npm run build` done in frontend/
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const children = [];
const start = (cmd, args, opts) => {
  const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.push(c);
  return c;
};
const waitFor = async (what, probe, ms = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

let code = 1;
try {
  if (!existsSync(`${root}frontend/dist/index.html`)) throw new Error("frontend/dist is missing: run `npm run build` in frontend/ first.");

  let serverLog = "";
  const server = start("node", [`${root}e2e/server.mjs`], { env: process.env });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  await waitFor("the test backend", async () => serverLog.includes("harness ready") || (server.exitCode !== null && (() => { throw new Error(`test backend exited:\n${serverLog}`); })()));

  const preview = start("node", [`${root}frontend/node_modules/vite/bin/vite.js`, "preview", "--strictPort"], { cwd: `${root}frontend` });
  await waitFor("the frontend", async () => (await fetch("http://localhost:3000/api/health")).ok);

  const tests = spawn("node", [`${root}e2e/run.mjs`], { stdio: "inherit", env: process.env });
  code = await new Promise((resolve) => tests.on("exit", (c) => resolve(c ?? 1)));
  if (preview.exitCode !== null) console.error("frontend preview exited early");
} catch (err) {
  console.error(err.message);
} finally {
  for (const c of children) c.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500)); // let the backend drop its throwaway database
  for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
}
process.exit(code);
