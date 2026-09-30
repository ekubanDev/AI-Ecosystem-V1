/** Capability -> roles allowed (spec: Database & API Specification §4, Technical Specification §29). */
export const CAPABILITIES = {
  "opportunities:read": ["OWNER", "ADMIN", "ANALYST", "VIEWER"],
  "opportunities:write": ["OWNER", "ADMIN", "ANALYST"],
  "opportunities:approve": ["OWNER", "ADMIN"],
  "agents:run": ["OWNER", "ADMIN", "ANALYST"], // discovery + analyze
  "agents:runDirect": ["OWNER", "ADMIN"], // POST /agents/:type/run, task retry
  "agents:read": ["OWNER", "ADMIN", "ANALYST", "VIEWER"],
  "experiments:read": ["OWNER", "ADMIN", "ANALYST", "VIEWER"],
  "experiments:write": ["OWNER", "ADMIN", "ANALYST"],
  "experiments:approve": ["OWNER", "ADMIN"], // start experiments above the budget threshold
  "users:manage": ["OWNER", "ADMIN"],
  "dashboard:read": ["OWNER", "ADMIN", "ANALYST", "VIEWER"],
};

export const can = (role, capability) => (CAPABILITIES[capability] ?? []).includes(role);
