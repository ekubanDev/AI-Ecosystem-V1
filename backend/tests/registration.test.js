import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

// Production closes public sign-up. The flag is read when the config loads, so set it before the harness does.
process.env.REGISTRATION_ENABLED = "false";
const { default: bcrypt } = await import("bcryptjs");
const { models, setup } = await import("./helpers.js");

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.cleanup());

describe("closed registration", () => {
  it("refuses sign-ups with 403 and creates nothing, even for what would have been the first OWNER", async () => {
    const res = await ctx.http.post("/api/auth/register").send({ name: "Stranger", email: "stranger@example.com", password: "StrongPassword123!" }).expect(403);
    assert.equal(res.body.error.code, "FORBIDDEN");
    assert.match(res.body.error.message, /Registration is closed/);
    assert.equal(await models.User.countDocuments(), 0);
  });

  it("tells the UI so it can hide the link, without needing a login", async () => {
    assert.deepEqual((await ctx.http.get("/api/auth/config").expect(200)).body.data, { registrationEnabled: false });
  });

  it("still lets an existing (seeded) account log in", async () => {
    await models.User.create({ name: "Owner", email: "owner@example.com", passwordHash: await bcrypt.hash("StrongPassword123!", 4), role: "OWNER", isEmailVerified: true });
    await ctx.http.post("/api/auth/login").send({ email: "owner@example.com", password: "StrongPassword123!" }).expect(200);
  });
});
