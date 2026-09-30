// Mirrors backend/config/permissions.js. This only decides which buttons to show; the server enforces every rule.
const CAPABILITIES = {
  "opportunities:write": ["OWNER", "ADMIN", "ANALYST"],
  "opportunities:approve": ["OWNER", "ADMIN"],
  "agents:run": ["OWNER", "ADMIN", "ANALYST"],
  "agents:runDirect": ["OWNER", "ADMIN"],
  "experiments:write": ["OWNER", "ADMIN", "ANALYST"],
  "experiments:approve": ["OWNER", "ADMIN"],
  "users:manage": ["OWNER", "ADMIN"],
};

export const can = (role, capability) => (CAPABILITIES[capability] ?? []).includes(role);
