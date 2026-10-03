import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HELPER = process.env.E2E_HELPER_URL ?? "http://127.0.0.1:3002"; // seeded credentials + captured emails (see server.mjs)
const SHOTS = new URL("./shots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const users = await (await fetch(`${HELPER}/users`)).json();
// PLAYWRIGHT_CHROMIUM_EXECUTABLE lets a machine with a pre-installed Chromium skip the managed browser download.
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox"] });
const errors = [];
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
};

async function session(role) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${role}] console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${role}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(users[role].email);
  await page.getByLabel("Password").fill(users[role].password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("navigation", { name: "Main" }).first().waitFor();
  return { ctx, page };
}
const shot = (page, n) => page.screenshot({ path: `${SHOTS}${n}.png`, fullPage: true });

// ---- auth ------------------------------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[anon] pageerror: ${e.message}`));
  await step("anonymous visit redirects to login", async () => { await page.goto(`${BASE}/opportunities`); await page.waitForURL("**/login"); });
  await step("wrong password shows the server error and stays on login", async () => {
    await page.getByLabel("Email").fill(users.ANALYST.email); await page.getByLabel("Password").fill("WrongPassword123!");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByText("Invalid email or password.").waitFor(); assert.match(page.url(), /login/);
    assert.ok(await page.getByText(/Request ID: req_/).isVisible());
  });
  await step("register → verification link from email → log in", async () => {
    await page.goto(`${BASE}/register`);
    const email = `newbie_${Date.now()}@example.com`;
    await page.getByLabel("Name").fill("New Person"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill("BrandNewPassword456!");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Check your email").waitFor();
    const emails = await (await fetch(`${HELPER}/emails`)).json();
    const msg = emails.filter((m) => m.to === email).pop();
    const link = /https?:\/\/\S+/.exec(msg.text)[0];
    await page.goto(link);
    await page.getByText("Your email is verified.").waitFor();
    await page.getByRole("link", { name: "Log in" }).click();
    await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill("BrandNewPassword456!");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    // brand-new accounts are read-only: no "Run discovery" button on the dashboard
    await page.goto(`${BASE}/discovery`);
    await page.getByText(/read-only access/).waitFor();
  });
  await ctx.close();
}

// ---- analyst: dashboard, live discovery run, opportunities, details ------------------------------------------------------
const analyst = await session("ANALYST");
const p = analyst.page;
await step("dashboard shows pipeline data from the seeded run", async () => {
  await p.getByRole("heading", { name: "Overview" }).waitFor();
  await p.getByText("Awaiting your approval").waitFor();
  await p.getByText("Procure Pilot").first().waitFor();
  await shot(p, "01-dashboard");
});
await step("session survives a full page reload (refresh cookie)", async () => {
  await p.reload(); await p.getByRole("heading", { name: "Overview" }).waitFor();
});
await step("live discovery run: queue → progress → completed", async () => {
  await p.getByRole("navigation").first().getByRole("link", { name: "Discovery" }).click();
  await p.getByRole("heading", { name: "Discovery", exact: true }).waitFor();
  await p.getByLabel("Market").fill("Kenya");
  await p.getByRole("button", { name: "Run discovery" }).first().click();
  await p.getByText("Discovery queued.").waitFor();
  await p.getByRole("row", { name: /Kenya/ }).first().click();
  await p.getByText(/Kenya, ?|request: Kenya/).first().waitFor();
  await shot(p, "02-run-progress");
  await p.getByText("Completed").first().waitFor({ timeout: 60000 });
  await shot(p, "03-run-complete");
  await p.getByRole("button", { name: "Close" }).click();
});
await step("opportunities list: filter by status and search, sort, open details", async () => {
  await p.goto(`${BASE}/opportunities`);
  await p.getByRole("link", { name: "Procure Pilot" }).first().waitFor();
  await p.getByLabel("Search").fill("Ledger");
  await p.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, null, { timeout: 5000 });
  assert.match(p.url(), /q=Ledger/);
  await shot(p, "04-opportunities");
  await p.getByLabel("Search").fill("");
  await p.getByRole("link", { name: "Procure Pilot" }).first().click();
  await p.getByRole("heading", { name: "Procure Pilot" }).waitFor();
});
await step("evidence tab separates cited facts from AI inference", async () => {
  await p.getByRole("tab", { name: "Evidence" }).click();
  await p.getByText(/claims cite a stored source/).waitFor();
  await p.getByText("INFERRED").first().waitFor();
  await p.getByText("VERIFIED").first().waitFor();
  const link = p.getByRole("link", { name: /Page at acme-procure|Result 1/ }).first();
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer nofollow");
  await shot(p, "05-evidence");
});
await step("business model, competitors, economics, differentiation tabs", async () => {
  await p.getByRole("tab", { name: "Business model" }).click();
  await p.getByText("SME distributors").waitFor(); await p.getByText("Business DNA").waitFor();
  await p.getByRole("tab", { name: "Competitors" }).click();
  await p.getByRole("heading", { name: "Acme Procure" }).waitFor();
  assert.ok(await p.getByText("Unknown").first().isVisible()); // Supplier Hub's invented pricing was stripped
  await shot(p, "06-competitors");
  await p.getByRole("tab", { name: "Economics" }).click();
  await p.getByText(/AI estimates, not facts/).waitFor();
  await shot(p, "07-economics");
  await p.getByRole("tab", { name: "Differentiation" }).click();
  await p.getByText("Local supplier database").waitFor();
});
await step("agent runs tab lists the pipeline tasks and opens a run with input/output", async () => {
  await p.getByRole("tab", { name: "Agent runs" }).click();
  await p.getByRole("cell", { name: "Research" }).first().waitFor();
  await p.getByRole("button", { name: "Runs" }).first().click();
  await p.getByRole("row", { name: /COMPLETED/ }).first().click();
  await p.getByText("Sources used").waitFor(); await p.getByText("Input").first().waitFor();
  await shot(p, "08-run-detail");
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
});
await step("analyst cannot approve: decision tab explains and offers no approve button", async () => {
  await p.getByRole("tab", { name: "Decision" }).click();
  await p.getByText(/Only owners and admins can approve/).waitFor();
  assert.equal(await p.getByRole("button", { name: "Approve" }).count(), 0);
});
await step("analyst: no Audit log nav, no History tab, /audit is guarded", async () => {
  assert.equal(await p.getByRole("link", { name: "Audit log" }).count(), 0);
  await p.goto(`${BASE}/audit`); await p.waitForURL(`${BASE}/`);
  await p.goto(`${BASE}/opportunities`); await p.getByRole("link", { name: "Procure Pilot" }).first().click();
  await p.getByRole("heading", { name: "Procure Pilot" }).waitFor();
  assert.equal(await p.getByRole("tab", { name: "History" }).count(), 0);
});
await analyst.ctx.close();

// ---- admin: approve, experiment lifecycle with the budget gate -----------------------------------------------------------
const admin = await session("ADMIN");
const a = admin.page;
await step("admin approves from the decision tab (note dialog)", async () => {
  await a.goto(`${BASE}/opportunities?status=AWAITING_APPROVAL`);
  await a.getByRole("link", { name: "Procure Pilot" }).first().click();
  await a.getByText(/waiting for your decision/).waitFor();
  await a.getByRole("button", { name: /Review & decide/ }).click();
  await shot(a, "09-decision");
  await a.getByRole("button", { name: "Approve" }).click();
  await a.getByLabel(/Note/).fill("Promising — test demand first.");
  await a.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await a.getByText("Approved", { exact: true }).first().waitFor();
  await a.getByText(/Approved .*Promising/).waitFor();
});
await step("rejection requires a reason", async () => {
  await a.goto(`${BASE}/opportunities?status=AWAITING_APPROVAL`);
  await a.getByRole("link", { name: "Ledger Lite" }).first().click();
  await a.getByRole("tab", { name: "Decision" }).click();
  await a.getByRole("button", { name: "Reject" }).click();
  const confirm = a.getByRole("dialog").getByRole("button", { name: "Reject" });
  assert.equal(await confirm.isDisabled(), true);
  await a.getByLabel(/Reason/).fill("Market too crowded");
  await confirm.click();
  await a.getByText("Rejected", { exact: true }).first().waitFor();
});
await step("experiment: create → ready → start (budget) → record results", async () => {
  await a.goto(`${BASE}/opportunities?status=APPROVED`);
  await a.getByRole("link", { name: "Procure Pilot" }).first().click();
  await a.getByRole("tab", { name: "Experiments" }).click();
  await a.getByRole("button", { name: "New experiment" }).click();
  await a.getByLabel("Name").fill("Landing page demand test");
  await a.getByLabel("Hypothesis").fill("5% of visitors submit interest.");
  assert.equal(await a.getByLabel("Budget").getAttribute("min"), "0");
  await a.getByLabel("Budget").fill("500"); await a.getByLabel("Currency").fill("ghs");
  await a.getByRole("button", { name: "Add metric" }).click();
  await a.getByLabel("Metric", { exact: true }).fill("qualified leads"); await a.getByLabel("Target", { exact: true }).fill("20");
  await a.getByRole("button", { name: "Create" }).click();
  await a.getByRole("row", { name: /Landing page demand test/ }).click();
  await a.getByRole("button", { name: "Mark ready" }).click();
  await a.getByRole("button", { name: "Start experiment" }).click();
  await shot(a, "10-start-experiment");
  await a.getByRole("dialog").last().getByRole("button", { name: "Start" }).click();
  await a.getByRole("button", { name: "Record results" }).waitFor();
  await a.getByRole("button", { name: "Record results" }).click();
  await a.getByLabel(/qualified leads — actual/).fill("22");
  await a.getByLabel(/^Results/).fill("22 leads from 410 visitors");
  await a.getByLabel(/^Conclusion/).fill("Demand supports a paid pilot.");
  await a.getByLabel(/^Next action/).fill("Run 3 paid pilots");
  await a.getByRole("button", { name: "Complete experiment" }).click();
  await a.goto(`${BASE}/experiments`);
  await a.getByRole("row", { name: /Landing page demand test.*Completed/ }).waitFor();
  await shot(a, "11-experiments");
});
await step("landing page: publish → visitor registers interest → lead appears → deleted on request", async () => {
  const visitorCtx = await browser.newContext(); const v = await visitorCtx.newPage();
  v.on("pageerror", (e) => errors.push(`[visitor] pageerror: ${e.message}`));
  // Unpublished pages are not visible.
  await v.goto(`${BASE}/p/procure-pilot`);
  await v.getByRole("heading", { name: "This page is not available" }).waitFor();

  await a.goto(`${BASE}/opportunities`);
  await a.getByRole("link", { name: "Procure Pilot" }).first().click();
  await a.getByRole("tab", { name: "Landing page & leads" }).click();
  await a.getByLabel(/^Headline/).fill("Find reliable suppliers in Ghana");
  await a.getByLabel(/^Bullet points/).fill("Verified profiles\nDirect contact");
  await a.getByRole("switch", { name: /Not published/ }).check();
  await a.getByRole("button", { name: "Save" }).click();
  await a.getByText("Saved.").waitFor();
  await shot(a, "14-landing-editor");

  await v.goto(`${BASE}/p/procure-pilot`);
  await v.getByRole("heading", { name: "Find reliable suppliers in Ghana" }).waitFor();
  await v.getByText("Verified profiles").waitFor();
  await v.getByLabel(/^Name/).fill("Visitor Vera");
  await v.getByLabel(/^Email/).fill("vera@example.com");
  await v.getByRole("button", { name: "Register my interest" }).click();
  await v.getByText(/Please tick the box/).waitFor(); // consent is required
  await v.getByRole("checkbox", { name: /I agree/ }).check();
  await shot(v, "15-public-landing");
  await v.getByRole("button", { name: "Register my interest" }).click();
  await v.getByText(/Thank you/).waitFor();
  await visitorCtx.close();

  await a.reload();
  await a.getByRole("tab", { name: "Landing page & leads" }).click();
  await a.getByRole("row", { name: /Visitor Vera.*vera@example\.com/ }).waitFor();
  await a.getByRole("button", { name: "Delete Visitor Vera" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
  await a.getByText("No leads yet.").waitFor();
});
await step("blueprint: draft for an approved opportunity, plan is labelled as hypotheses", async () => {
  await a.goto(`${BASE}/opportunities`);
  await a.getByRole("link", { name: "Procure Pilot" }).first().click();
  await a.getByRole("tab", { name: "Blueprint" }).click();
  await a.getByText(/not evidence that the business will work/).waitFor();
  await a.getByRole("button", { name: "Draft blueprint" }).click();
  await a.getByRole("heading", { name: "Positioning" }).waitFor();
  await a.getByText(/Ideas only/).waitFor();
  await a.getByText("Needs your approval").first().waitFor(); // paid ads / legal steps are always the owner's call
  await a.getByText(/No validation experiment has been completed|No basis stated/).first().waitFor();
  await a.getByRole("button", { name: "Regenerate blueprint" }).waitFor();
  await shot(a, "16-blueprint");
});
await step("users page: admin sees users, cannot edit owners/admins/self", async () => {
  await a.goto(`${BASE}/users`);
  await a.getByRole("heading", { name: "Users" }).waitFor();
  assert.equal(await a.getByLabel(/Role for Owner User/).count(), 0);
  assert.ok(await a.getByLabel(/Role for Analyst User/).isVisible());
  await shot(a, "12-users");
});
await step("agents page: registry shows permissions; runs & tasks tabs load", async () => {
  await a.goto(`${BASE}/agents?tab=registry`);
  await a.getByText("Opportunity Scout").first().waitFor(); await a.getByText(/External access: search/).first().waitFor();
  await a.getByRole("tab", { name: "Runs" }).click(); await a.getByRole("row", { name: /Research/ }).first().waitFor();
  await a.getByRole("tab", { name: "Tasks" }).click(); await a.getByRole("row", { name: /Research/ }).first().waitFor();
  await shot(a, "13-agents");
});
await step("audit log: admin sees who did what, filters, and opens event detail", async () => {
  await a.goto(`${BASE}/audit`);
  await a.getByRole("heading", { name: "Audit log" }).waitFor();
  await a.getByRole("row", { name: /Opportunity approved/ }).first().waitFor();
  await shot(a, "15-audit");
  await a.getByLabel("Action").click();
  await a.getByRole("option", { name: "Opportunity approved" }).click();
  await a.getByRole("row", { name: /Opportunity approved/ }).first().waitFor();
  await a.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1, null, { timeout: 8000 }); // list keeps old rows until the filtered query lands
  const row = await a.locator("tbody tr").first().innerText();
  assert.match(row, /Admin User/); assert.match(row, /Promising/);
  await a.locator("tbody tr").first().click();
  await a.getByRole("dialog").getByText("Request ID").waitFor();
  await shot(a, "16-audit-detail");
  await a.keyboard.press("Escape");
});
await step("opportunity History tab shows the ordered status path", async () => {
  await a.goto(`${BASE}/opportunities?status=EXPERIMENT`);
  await a.getByRole("link", { name: "Procure Pilot" }).first().click();
  await a.getByRole("tab", { name: "History" }).click();
  await a.getByRole("row", { name: /Opportunity created/ }).waitFor();
  const text = (await a.locator("tbody").innerText()).replace(/\s+/g, " ");
  const order = ["Discovered → Researching", "Researching → Analyzing", "Analyzing → Validated", "Validated → Awaiting approval", "Awaiting approval → Approved", "Approved → Experiment"].map((s) => text.indexOf(s));
  assert.ok(order.every((i) => i >= 0), `all transitions present: ${order}`);
  assert.deepEqual(order, [...order].sort((x, y) => x - y), "in chronological order");
  await shot(a, "17-history");
});
await admin.ctx.close();

// ---- viewer: read-only everywhere ---------------------------------------------------------------------------------------
const viewer = await session("VIEWER");
const v = viewer.page;
await step("viewer is read-only: no create/run/approve controls; Users hidden and route guarded", async () => {
  await v.goto(`${BASE}/opportunities`);
  await v.getByRole("link", { name: "Procure Pilot" }).first().waitFor();
  assert.equal(await v.getByRole("button", { name: "New opportunity" }).count(), 0);
  assert.equal(await v.getByRole("link", { name: "Users" }).count(), 0);
  await v.goto(`${BASE}/discovery`); await v.getByText(/read-only access/).waitFor();
  await v.goto(`${BASE}/users`); await v.waitForURL(`${BASE}/`);
});
await step("mobile viewport: navigation collapses into a drawer", async () => {
  await v.setViewportSize({ width: 390, height: 800 });
  await v.goto(`${BASE}/`);
  await v.getByRole("button", { name: "Open navigation" }).click();
  await v.getByRole("link", { name: "Opportunities" }).last().click();
  await v.getByRole("heading", { name: "Opportunities" }).waitFor();
  await shot(v, "14-mobile");
  assert.ok(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll on mobile");
});
await step("logout returns to login and protects routes again", async () => {
  await v.setViewportSize({ width: 1360, height: 900 });
  await v.goto(`${BASE}/`);
  await v.getByRole("button", { name: /Log out/ }).click();
  await v.waitForURL("**/login");
  await v.goto(`${BASE}/opportunities`); await v.waitForURL("**/login");
});
await viewer.ctx.close();

await browser.close();
console.log(results.map((r) => r.join(" | ")).join("\n"));
console.log("\nbrowser errors:", errors.length ? "\n" + errors.join("\n") : "none");
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
