import axios from "axios";

/** Error thrown for every failed API call: mirrors the backend's { error: { code, message, details } } envelope. */
export class ApiError extends Error {
  constructor({ status, code, message, details = [], requestId }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const toApiError = (err) => {
  const body = err.response?.data;
  if (body?.error) return new ApiError({ status: err.response.status, ...body.error, requestId: body.meta?.requestId });
  return new ApiError({ status: err.response?.status ?? 0, code: "NETWORK_ERROR", message: err.response ? `Request failed (${err.response.status})` : "Cannot reach the server." });
};

// The access token lives only in memory; the refresh token is an HttpOnly cookie the page cannot read.
let accessToken = null;
let onAuthLost = () => {};
export const setAccessToken = (t) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;
export const setAuthLostHandler = (fn) => {
  onAuthLost = fn;
};

export const http = axios.create({ baseURL: "/api", withCredentials: true });

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing = null;
/** Single-flight refresh: concurrent 401s share one call, which matters because refresh tokens rotate (a second call would invalidate the first). */
export function refreshSession() {
  refreshing ??= axios
    .post("/api/auth/refresh", null, { withCredentials: true })
    .then((r) => {
      accessToken = r.data.data.accessToken;
      return r.data.data;
    })
    .catch((e) => {
      accessToken = null;
      throw toApiError(e);
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const RETRYABLE_AUTH = new Set(["TOKEN_EXPIRED", "TOKEN_INVALID", "AUTH_REQUIRED"]);

http.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config;
    const code = err.response?.data?.error?.code;
    if (err.response?.status === 401 && cfg && !cfg._retried && !cfg.url?.startsWith("/auth/") && RETRYABLE_AUTH.has(code)) {
      cfg._retried = true;
      try {
        await refreshSession();
        return http(cfg);
      } catch {
        onAuthLost();
      }
    }
    throw toApiError(err);
  }
);

/** Returns the response envelope: { data, meta }. */
export const request = async (method, url, { params, body, headers } = {}) => (await http.request({ method, url, params, data: body, headers })).data;
export const get = (url, params) => request("get", url, { params });
export const post = (url, body, opts) => request("post", url, { body, ...opts });
export const patch = (url, body) => request("patch", url, { body });
export const del = (url) => request("delete", url);

/** Drops empty filter values so they don't reach the server as `status=`. */
export const cleanParams = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null));

/** Idempotency-Key header for retry-sensitive POSTs. */
export const idempotencyHeaders = (key) => (key ? { "Idempotency-Key": key } : undefined);
