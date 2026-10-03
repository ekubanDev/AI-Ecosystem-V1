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
  "landing:publish": ["OWNER", "ADMIN"], // makes a page public: outward-facing, so not an analyst action
  "leads:read": ["OWNER", "ADMIN", "ANALYST"], // leads are personal data: VIEWER cannot see them
  "leads:write": ["OWNER", "ADMIN", "ANALYST"],
  "users:manage": ["OWNER", "ADMIN"],
  "audit:read": ["OWNER", "ADMIN"], // audit events include IP addresses, user agents and before/after snapshots
  "dashboard:read": ["OWNER", "ADMIN", "ANALYST", "VIEWER"],
};

export const can = (role, capability) => (CAPABILITIES[capability] ?? []).includes(role);
