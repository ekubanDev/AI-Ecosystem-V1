// Test-only backend for the browser suite: the real API + worker on a real MongoDB, with the same fake AI / search / email
// providers the backend tests use (so no network and no API keys), seeded with one user per role and one finished discovery.
// Also serves a tiny helper on 127.0.0.1:3002 exposing the seeded credentials and captured emails. NEVER deploy this.
process.env.WORKER_POLL_MS ??= "300";
const B = new URL("../backend/", import.meta.url).pathname;
const { setup, makeUser, as } = await import(`${B}tests/helpers.js`);
const http = await import("node:http");

const ctx = await setup();
const users = {};
for (const role of ["OWNER", "ADMIN", "ANALYST", "VIEWER"]) users[role] = await makeUser(ctx, role, { name: `${role[0]}${role.slice(1).toLowerCase()} User` });

// One completed run so pages have real pipeline data before the browser starts.
ctx.provider.delayMs = 0;
await as(ctx, users.ANALYST).post("/api/discovery/run").send({ market: "Ghana", count: 5 }).expect(202);
await ctx.container.worker.drain();
ctx.provider.delayMs = 500; // slow enough that live progress is observable in the UI
await ctx.container.worker.start();

ctx.app.listen(3001, "127.0.0.1");
http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/users") return res.end(JSON.stringify(Object.fromEntries(Object.entries(users).map(([k, u]) => [k, { email: u.email, password: u.password }]))));
    res.end(JSON.stringify(ctx.emails));
  })
  .listen(3002, "127.0.0.1");

const stop = async () => {
  await ctx.cleanup();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log("harness ready");
