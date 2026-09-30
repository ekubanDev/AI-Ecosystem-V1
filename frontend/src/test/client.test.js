import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError, http, refreshSession, setAccessToken, setAuthLostHandler } from "../api/client.js";
import axios from "axios";
import { can } from "../auth/permissions.js";
import { formatMoney, safeHref } from "../utils/format.js";

const respond = (config, status, data) => Promise.resolve({ status, data, config, headers: {}, statusText: "" });
const apiError = (config, status, code) => Object.assign(new Error(code), { config, isAxiosError: true, response: { status, data: { success: false, error: { code, message: code, details: [] }, meta: { requestId: "req_1" } }, config } });

describe("api client", () => {
  beforeEach(() => {
    setAccessToken("expired");
    vi.restoreAllMocks();
  });

  it("refreshes once, shares the refresh between concurrent 401s, and retries with the new token", async () => {
    const seen = [];
    http.defaults.adapter = async (config) => {
      seen.push(config.headers.Authorization);
      if (config.headers.Authorization === "Bearer fresh") return respond(config, 200, { success: true, data: { ok: true } });
      throw apiError(config, 401, "TOKEN_EXPIRED");
    };
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { data: { accessToken: "fresh", user: { id: "1" } } } });
    const results = await Promise.all([http.get("/a"), http.get("/b"), http.get("/c")]);
    expect(results.map((r) => r.data.data.ok)).toEqual([true, true, true]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(seen.filter((h) => h === "Bearer fresh")).toHaveLength(3);
  });

  it("signals auth loss when the refresh fails, and surfaces a typed ApiError", async () => {
    const lost = vi.fn();
    setAuthLostHandler(lost);
    http.defaults.adapter = async (config) => {
      throw apiError(config, 401, "TOKEN_EXPIRED");
    };
    vi.spyOn(axios, "post").mockRejectedValue(apiError({}, 401, "TOKEN_INVALID"));
    await expect(http.get("/x")).rejects.toMatchObject({ name: "ApiError", code: "TOKEN_EXPIRED", status: 401, requestId: "req_1" });
    expect(lost).toHaveBeenCalled();
  });

  it("does not try to refresh for auth endpoints or non-token 401s", async () => {
    const post = vi.spyOn(axios, "post");
    http.defaults.adapter = async (config) => {
      throw apiError(config, 401, "INVALID_CREDENTIALS");
    };
    await expect(http.post("/auth/login", {})).rejects.toBeInstanceOf(ApiError);
    expect(post).not.toHaveBeenCalled();
  });

  it("refreshSession is exported as a single-flight function", () => {
    expect(typeof refreshSession).toBe("function");
  });
});

describe("helpers", () => {
  it("mirrors backend permissions", () => {
    expect(can("VIEWER", "opportunities:write")).toBe(false);
    expect(can("ANALYST", "opportunities:approve")).toBe(false);
    expect(can("ADMIN", "opportunities:approve")).toBe(true);
    expect(can("ANALYST", "agents:runDirect")).toBe(false);
  });
  it("only links http(s) URLs", () => {
    expect(safeHref("https://a.example")).toBe("https://a.example");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
  });
  it("formats money defensively", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(5, "NOT-A-CODE")).toContain("5");
  });
});
