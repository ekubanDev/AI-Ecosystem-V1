import { OpportunityScout } from "./opportunityScout.js";
import { ResearchAgent } from "./researchAgent.js";
import { CompetitorAgent } from "./competitorAgent.js";
import { BusinessModelAgent } from "./businessModelAgent.js";
import { OpportunityAnalyst } from "./opportunityAnalyst.js";
import { createAgentRegistry } from "./registry.js";

export const createDefaultRegistry = () =>
  createAgentRegistry([new OpportunityScout(), new ResearchAgent(), new CompetitorAgent(), new BusinessModelAgent(), new OpportunityAnalyst()]);
