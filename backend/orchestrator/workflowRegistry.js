/** Per-opportunity analysis chain run after an opportunity exists (spec §18 pipeline: Research → Competitor → Business model → Analysis). */
export const ANALYSIS_CHAIN = ["RESEARCH", "COMPETITOR", "BUSINESS_MODEL", "OPPORTUNITY_ANALYST"];

export const nextInChain = (agentType) => ANALYSIS_CHAIN[ANALYSIS_CHAIN.indexOf(agentType) + 1] ?? null;
export const isChainAgent = (agentType) => ANALYSIS_CHAIN.includes(agentType);

export const WORKFLOWS = {
  DISCOVERY: "DISCOVERY", // Scout → dedupe → chain per opportunity; tracked by a DiscoveryRun
  ANALYSIS: "ANALYSIS", // chain for one existing opportunity
  MANUAL: "MANUAL", // single direct agent execution, no automatic follow-up
};

/** Which write kinds each persistence handler needs; checked against the agent's declared permissions. */
export const WRITE_KIND = {
  OPPORTUNITY_SCOUT: "candidates",
  RESEARCH: "evidence",
  COMPETITOR: "competitors",
  BUSINESS_MODEL: "businessModel",
  OPPORTUNITY_ANALYST: "analysis",
  BUSINESS_ARCHITECT: "blueprint",
};
