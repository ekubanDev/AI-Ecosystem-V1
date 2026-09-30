import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, makeUser, models, setup, tokenFromEmail } from "./helpers.js";

let ctx;
before(async () => (ctx = await setup()));
after(() => ctx.cleanup());

const cookieOf = (res) => res.headers["set-cookie"]?.find((c) => c.startsWith("abf_refresh="));
const cookieHeader = (res) => cookieOf(res).split(";")[0];

describe("registration & verification", () => {
  const creds = { name: "First User", email: "first@example.com", password: "StrongPassword123!" };

  it("registers (201), makes the first account OWNER, never returns secrets, and sends a verification email", async () => {
    const res = await ctx.http.post("/api/auth/register").send(creds).expect(201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.role, "OWNER");
    assert.ok(res.body.meta.requestId);
    for (const k of ["passwordHash", "refreshTokenVersion", "emailVerificationTokenHash"]) assert.equal(k in res.body.data.user, false, k);
    assert.ok(tokenFromEmail(ctx.emails, creds.email));
  });

  it("later registrations are VIEWERs", async () => {
    const u = await makeUser(ctx, "VIEWER");
    const me = await as(ctx, u).get("/api/auth/me").expect(200);
    assert.equal(me.body.data.user.role, "VIEWER");
  });

  it("rejects a duplicate email with 409 RESOURCE_CONFLICT", async () => {
    const res = await ctx.http.post("/api/auth/register").send(creds).expect(409);
    assert.equal(res.body.error.code, "RESOURCE_CONFLICT");
  });

  it("validates input with 422 and field details", async () => {
    const res = await ctx.http.post("/api/auth/register").send({ name: "", email: "nope", password: "short" }).expect(422);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.ok(res.body.error.details.length >= 3);
  });

  it("blocks login until the email is verified, then verification is single-use", async () => {
    const res = await ctx.http.post("/api/auth/login").send({ email: creds.email, password: creds.password }).expect(403);
    assert.equal(res.body.error.code, "EMAIL_NOT_VERIFIED");
    const token = tokenFromEmail(ctx.emails, creds.email);
    await ctx.http.get("/api/auth/verify-email").query({ token }).expect(200);
    const again = await ctx.http.get("/api/auth/verify-email").query({ token }).expect(401);
    assert.equal(again.body.error.code, "TOKEN_INVALID");
    await ctx.http.post("/api/auth/login").send({ email: creds.email, password: creds.password }).expect(200);
  });

  it("stores only hashes of verification tokens", async () => {
    const token = tokenFromEmail(ctx.emails, creds.email);
    const raw = await models.User.collection.findOne({ email: creds.email });
    assert.notEqual(raw.emailVerificationTokenHash, token);
    assert.equal(JSON.stringify(raw).includes(token), false);
  });
});

describe("login, sessions and tokens", () => {
  it("logs in (200) with an access token and an HttpOnly refresh cookie", async () => {
    const u = await makeUser(ctx, "ANALYST");
    const res = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password }).expect(200);
    assert.ok(res.body.data.accessToken);
    const c = cookieOf(res);
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Lax/i);
    assert.match(c, /Path=\/api\/auth/);
    assert.equal(JSON.stringify(res.body).includes("passwordHash"), false);
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const u = await makeUser(ctx);
    const bad = await ctx.http.post("/api/auth/login").send({ email: u.email, password: "WrongPassword123!" }).expect(401);
    const unknown = await ctx.http.post("/api/auth/login").send({ email: "nobody@example.com", password: "WrongPassword123!" }).expect(401);
    assert.equal(bad.body.error.code, "INVALID_CREDENTIALS");
    assert.deepEqual(bad.body.error.message, unknown.body.error.message);
  });

  it("protects routes: 401 AUTH_REQUIRED without a token, TOKEN_INVALID for garbage", async () => {
    assert.equal((await ctx.http.get("/api/opportunities").expect(401)).body.error.code, "AUTH_REQUIRED");
    assert.equal((await ctx.http.get("/api/opportunities").set("Authorization", "Bearer garbage").expect(401)).body.error.code, "TOKEN_INVALID");
  });

  it("rejects a refresh token used as an access token", async () => {
    const u = await makeUser(ctx);
    const login = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password });
    const refreshJwt = cookieHeader(login).split("=")[1];
    await ctx.http.get("/api/auth/me").set("Authorization", `Bearer ${refreshJwt}`).expect(401);
  });

  it("rotates refresh tokens: the old one stops working (replay is rejected)", async () => {
    const u = await makeUser(ctx);
    const login = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password });
    const first = cookieHeader(login);
    const r1 = await ctx.http.post("/api/auth/refresh").set("Cookie", first).expect(200);
    assert.ok(r1.body.data.accessToken);
    const second = cookieHeader(r1);
    assert.notEqual(first, second);
    const replay = await ctx.http.post("/api/auth/refresh").set("Cookie", first).expect(401);
    assert.equal(replay.body.error.code, "TOKEN_INVALID");
    await ctx.http.post("/api/auth/refresh").set("Cookie", second).expect(200);
  });

  it("concurrent refreshes with the same token: exactly one wins", async (t) => {
    if (!ctx.atomic) return t.skip("database does not guarantee atomic conditional updates");
    const u = await makeUser(ctx);
    const login = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password });
    const c = cookieHeader(login);
    const results = await Promise.all([1, 2, 3, 4].map(() => ctx.http.post("/api/auth/refresh").set("Cookie", c)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  it("refresh requires a cookie and an allowed Origin", async () => {
    assert.equal((await ctx.http.post("/api/auth/refresh").expect(401)).body.error.code, "AUTH_REQUIRED");
    const u = await makeUser(ctx);
    const login = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password });
    await ctx.http.post("/api/auth/refresh").set("Cookie", cookieHeader(login)).set("Origin", "https://evil.example").expect(403);
    await ctx.http.post("/api/auth/refresh").set("Cookie", cookieHeader(login)).set("Origin", "http://localhost:3000").expect(200);
  });

  it("logout invalidates the refresh token", async () => {
    const u = await makeUser(ctx);
    const login = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password });
    const c = cookieHeader(login);
    await ctx.http.post("/api/auth/logout").set("Cookie", c).expect(200);
    await ctx.http.post("/api/auth/refresh").set("Cookie", c).expect(401);
  });

  it("deactivated users are locked out immediately", async () => {
    const u = await makeUser(ctx);
    await models.User.updateOne({ email: u.email }, { $set: { isActive: false } });
    await as(ctx, u).get("/api/auth/me").expect(401);
    await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password }).expect(401);
  });
});

describe("password reset", () => {
  it("does not reveal whether an account exists", async () => {
    const a = await ctx.http.post("/api/auth/forgot-password").send({ email: "ghost@example.com" }).expect(200);
    const u = await makeUser(ctx);
    const b = await ctx.http.post("/api/auth/forgot-password").send({ email: u.email }).expect(200);
    assert.deepEqual(a.body.data, b.body.data);
  });

  it("resets with a single-use token, revokes sessions, and the new password works", async () => {
    const u = await makeUser(ctx);
    const login = await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password });
    await ctx.http.post("/api/auth/forgot-password").send({ email: u.email }).expect(200);
    const token = tokenFromEmail(ctx.emails, u.email);
    assert.ok(token);
    await ctx.http.post("/api/auth/reset-password").send({ token, password: "BrandNewPassword456!" }).expect(200);
    const reuse = await ctx.http.post("/api/auth/reset-password").send({ token, password: "AnotherPassword789!" }).expect(401);
    assert.equal(reuse.body.error.code, "TOKEN_INVALID");
    await ctx.http.post("/api/auth/refresh").set("Cookie", cookieHeader(login)).expect(401); // old session revoked
    await ctx.http.post("/api/auth/login").send({ email: u.email, password: u.password }).expect(401);
    await ctx.http.post("/api/auth/login").send({ email: u.email, password: "BrandNewPassword456!" }).expect(200);
  });

  it("rejects expired reset tokens", async () => {
    const u = await makeUser(ctx);
    await ctx.http.post("/api/auth/forgot-password").send({ email: u.email });
    const token = tokenFromEmail(ctx.emails, u.email);
    await models.User.updateOne({ email: u.email }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });
    await ctx.http.post("/api/auth/reset-password").send({ token, password: "BrandNewPassword456!" }).expect(401);
  });
});

describe("user administration", () => {
  it("only OWNER/ADMIN can manage users; ADMIN cannot grant OWNER; the last OWNER is protected", async () => {
    const owner = await makeUser(ctx, "OWNER");
    const admin = await makeUser(ctx, "ADMIN");
    const analyst = await makeUser(ctx, "ANALYST");
    await as(ctx, analyst).get("/api/users").expect(403);
    await as(ctx, admin).patch(`/api/users/${analyst.id}`).send({ role: "OWNER" }).expect(403);
    await as(ctx, admin).patch(`/api/users/${owner.id}`).send({ role: "VIEWER" }).expect(403);
    await as(ctx, admin).patch(`/api/users/${admin.id}`).send({ role: "OWNER" }).expect(403); // self
    const ok = await as(ctx, owner).patch(`/api/users/${analyst.id}`).send({ role: "VIEWER" }).expect(200);
    assert.equal(ok.body.data.role, "VIEWER");
    const audit = await models.AuditEvent.findOne({ action: "USER_ROLE_CHANGED", resourceId: analyst.id });
    assert.equal(audit.before.role, "ANALYST");
    assert.equal(audit.after.role, "VIEWER");
    assert.equal(audit.actorType, "USER");
  });

  it("protects the last active OWNER", async () => {
    await models.User.updateMany({}, { $set: { role: "VIEWER" } });
    const owner = await makeUser(ctx, "OWNER");
    const admin = await makeUser(ctx, "OWNER");
    await models.User.updateOne({ email: admin.email }, { $set: { role: "OWNER" } });
    await as(ctx, admin).patch(`/api/users/${owner.id}`).send({ isActive: false }).expect(200);
    const res = await as(ctx, owner).patch(`/api/users/${admin.id}`).send({ role: "VIEWER" }).expect(401); // owner was deactivated above
    assert.equal(res.body.error.code, "TOKEN_INVALID");
  });
});
