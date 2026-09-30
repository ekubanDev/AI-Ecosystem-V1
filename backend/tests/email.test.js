import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeUser, models, setup, tokenFromEmail } from "./helpers.js"; // first: sets the test env (incl. silent logging) before app modules load
import { loadEnv } from "../config/env.js";
import { createGmailTransport } from "../services/emailTransports.js";
import { createEmailService } from "../services/emailService.js";

const secrets = { JWT_ACCESS_SECRET: "a".repeat(32), JWT_REFRESH_SECRET: "b".repeat(32) };

describe("Gmail transport", () => {
  it("sends plain-text mail through the injected mailer", async () => {
    const sent = [];
    const t = createGmailTransport({ user: "me@gmail.com", appPassword: "x", from: "AI Business Factory <me@gmail.com>", mailer: { sendMail: async (m) => sent.push(m) } });
    await t.send({ from: "ignored@example.com", to: "u@example.com", subject: "Hi", text: "Body" });
    assert.deepEqual(sent, [{ from: "AI Business Factory <me@gmail.com>", to: "u@example.com", subject: "Hi", text: "Body" }]);
  });

  it("maps failures to a retryable EXTERNAL_SERVICE_ERROR without leaking credentials", async () => {
    const boom = (over) => createGmailTransport({ user: "me@gmail.com", appPassword: "super-secret-pass", mailer: { sendMail: async () => { throw Object.assign(new Error("connect ETIMEDOUT"), over); } } });
    await assert.rejects(boom({}).send({ to: "u@x.io", subject: "s", text: "t" }), (e) => e.code === "EXTERNAL_SERVICE_ERROR" && e.retryable === true && /ETIMEDOUT/.test(e.message));
    await assert.rejects(boom({ responseCode: 535, message: "Invalid login super-secret-pass" }).send({ to: "u@x.io", subject: "s", text: "t" }), (e) => /App Password/.test(e.message) && !e.message.includes("super-secret-pass"));
  });

  it("builds verification and reset emails with links to the client app", async () => {
    const sent = [];
    const svc = createEmailService({ config: { EMAIL_FROM: "f@x.io", clientUrl: "https://app.example" }, transport: { send: async (m) => sent.push(m) } });
    await svc.sendVerification({ email: "u@x.io", name: "U" }, "tok/en");
    await svc.sendPasswordReset({ email: "u@x.io", name: "U" }, "tok2");
    assert.match(sent[0].text, /https:\/\/app\.example\/verify-email\?token=tok%2Fen/);
    assert.match(sent[1].text, /https:\/\/app\.example\/reset-password\?token=tok2/);
  });
});

describe("Gmail configuration", () => {
  it("requires both GMAIL_USER and GMAIL_APP_PASSWORD, or neither", () => {
    assert.throws(() => loadEnv({ ...secrets, GMAIL_USER: "me@gmail.com" }), /both GMAIL_USER and GMAIL_APP_PASSWORD/);
    assert.throws(() => loadEnv({ ...secrets, GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" }), /both GMAIL_USER and GMAIL_APP_PASSWORD/);
    assert.equal(loadEnv({ ...secrets }).GMAIL_USER, undefined);
    assert.equal(loadEnv({ ...secrets, GMAIL_USER: "", GMAIL_APP_PASSWORD: "" }).GMAIL_USER, undefined); // blank .env lines mean "unset"
  });
  it("accepts Google's spaced app-password format", () => {
    const c = loadEnv({ ...secrets, GMAIL_USER: "me@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" });
    assert.equal(c.gmailAppPassword, "abcdefghijklmnop");
    assert.throws(() => loadEnv({ ...secrets, GMAIL_USER: "not-an-email", GMAIL_APP_PASSWORD: "x" }));
  });
});

describe("email delivery failures never break the request", () => {
  let ctx, failing = true;
  const sent = [];
  before(async () => {
    ctx = await setup({ emailTransport: { send: async (m) => { if (failing) throw new Error("smtp down"); sent.push(m); } } });
  });
  after(() => ctx.cleanup());

  it("registration still succeeds (201) when the email cannot be sent, and resend works once it recovers", async () => {
    const creds = { name: "Ada", email: "ada@example.com", password: "StrongPassword123!" };
    const res = await ctx.http.post("/api/auth/register").send(creds).expect(201);
    assert.equal(res.body.data.user.email, "ada@example.com");
    assert.ok(await models.User.exists({ email: creds.email }));
    await ctx.http.post("/api/auth/login").send(creds).expect(403); // unverified, as expected

    failing = false;
    await ctx.http.post("/api/auth/resend-verification").send({ email: creds.email }).expect(200);
    const token = tokenFromEmail(sent, creds.email);
    assert.ok(token);
    await ctx.http.get("/api/auth/verify-email").query({ token }).expect(200);
    await ctx.http.post("/api/auth/login").send(creds).expect(200);
  });

  it("forgot-password stays 200 and uniform when sending fails", async () => {
    failing = true;
    const known = await ctx.http.post("/api/auth/forgot-password").send({ email: "ada@example.com" }).expect(200);
    const unknown = await ctx.http.post("/api/auth/forgot-password").send({ email: "ghost@example.com" }).expect(200);
    assert.deepEqual(known.body.data, unknown.body.data);
  });

  it("the test helper still works with a capturing transport", async () => {
    failing = false;
    const u = await makeUser({ ...ctx, emails: sent }, "VIEWER");
    assert.ok(u.token);
  });
});
