import { AppError } from "../utils/errors.js";

export function createAgentRegistry(agents) {
  const map = new Map(agents.map((a) => [a.agentType, a]));
  return {
    get(agentType) {
      const a = map.get(agentType);
      if (!a) throw new AppError("RESOURCE_NOT_FOUND", `Unknown agent: ${agentType}`);
      return a;
    },
    has: (t) => map.has(t),
    list: () => [...map.values()],
  };
}
