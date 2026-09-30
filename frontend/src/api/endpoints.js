import { cleanParams, del, get, idempotencyHeaders, patch, post } from "./client.js";

// List endpoints resolve to { items, pagination }; everything else to the unwrapped `data`.
const list = async (url, params) => {
  const { data, meta } = await get(url, cleanParams(params ?? {}));
  return { items: data, pagination: meta.pagination };
};
const one = async (p) => (await p).data;

export const auth = {
  login: (body) => one(post("/auth/login", body)),
  register: (body) => one(post("/auth/register", body)),
  logout: () => one(post("/auth/logout")),
  verifyEmail: (token) => one(post("/auth/verify-email", { token })),
  resendVerification: (email) => one(post("/auth/resend-verification", { email })),
  forgotPassword: (email) => one(post("/auth/forgot-password", { email })),
  resetPassword: (body) => one(post("/auth/reset-password", body)),
};

export const dashboard = {
  summary: () => one(get("/dashboard/summary")),
  opportunities: () => one(get("/dashboard/opportunities")),
  agentActivity: () => one(get("/dashboard/agent-activity")),
  experiments: () => one(get("/dashboard/experiments")),
};

export const opportunities = {
  list: (params) => list("/opportunities", params),
  get: (id) => one(get(`/opportunities/${id}`)),
  create: (body) => one(post("/opportunities", body)),
  update: (id, body) => one(patch(`/opportunities/${id}`, body)),
  remove: (id) => one(del(`/opportunities/${id}`)),
  analyze: (id) => one(post(`/opportunities/${id}/analyze`)),
  approve: (id, note) => one(post(`/opportunities/${id}/approve`, note ? { note } : {})),
  reject: (id, reason) => one(post(`/opportunities/${id}/reject`, { reason })),
  pause: (id, note) => one(post(`/opportunities/${id}/pause`, note ? { note } : {})),
  resume: (id) => one(post(`/opportunities/${id}/resume`)),
};

export const discovery = {
  run: (body, key) => one(post("/discovery/run", body, { headers: idempotencyHeaders(key) })),
  list: (params) => list("/discovery/runs", params),
  get: (id) => one(get(`/discovery/runs/${id}`)),
  cancel: (id) => one(post(`/discovery/runs/${id}/cancel`)),
};

export const experiments = {
  list: (params) => list("/experiments", params),
  get: (id) => one(get(`/experiments/${id}`)),
  create: (body) => one(post("/experiments", body)),
  update: (id, body) => one(patch(`/experiments/${id}`, body)),
  start: (id, key) => one(post(`/experiments/${id}/start`, undefined, { headers: idempotencyHeaders(key) })),
  complete: (id, body) => one(post(`/experiments/${id}/complete`, body)),
  cancel: (id) => one(post(`/experiments/${id}/cancel`)),
};

export const agents = {
  list: () => one(get("/agents")),
  runs: (params) => list("/agents/runs", params),
  run: (id) => one(get(`/agents/runs/${id}`)),
  tasks: (params) => list("/agents/tasks", params),
  retryTask: (id) => one(post(`/agents/tasks/${id}/retry`)),
  runAgent: (agentType, body, key) => one(post(`/agents/${agentType}/run`, body, { headers: idempotencyHeaders(key) })),
};

export const audit = {
  list: (params) => list("/audit", params),
  facets: () => one(get("/audit/facets")),
};

export const users = {
  list: (params) => list("/users", params),
  update: (id, body) => one(patch(`/users/${id}`, body)),
};
