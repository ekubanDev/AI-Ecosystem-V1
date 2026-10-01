import { createDefaultRegistry } from "./agents/index.js";
import { createOrchestrator } from "./orchestrator/orchestrator.js";
import { createTaskRunner } from "./orchestrator/taskRunner.js";
import { createTaskWorker } from "./orchestrator/taskWorker.js";
import { createAIService, createOpenAIProvider } from "./services/aiService.js";
import { createAuthService } from "./services/authService.js";
import { createEmailService } from "./services/emailService.js";
import { createGmailTransport } from "./services/emailTransports.js";
import { createResearchService } from "./services/researchService.js";
import { createSearchProvider } from "./services/searchProviders.js";

/**
 * Wires services together. Every external dependency can be overridden (tests inject a fake AI provider,
 * fake search provider and capturing email transport; nothing in the test suite touches the network).
 */
export function createContainer(config, overrides = {}) {
  const aiProvider = overrides.aiProvider !== undefined ? overrides.aiProvider : config.OPENAI_API_KEY ? createOpenAIProvider({ apiKey: config.OPENAI_API_KEY }) : null;
  const searchProvider = overrides.searchProvider !== undefined ? overrides.searchProvider : createSearchProvider(config);

  const registry = createDefaultRegistry();
  const ai = createAIService({ config, provider: aiProvider });
  const research = createResearchService({ searchProvider, fetcher: overrides.fetcher, blockedDomains: config.SEARCH_BLOCKED_DOMAINS.split(",") });
  const emailTransport =
    overrides.emailTransport ??
    (config.GMAIL_USER ? createGmailTransport({ user: config.GMAIL_USER, appPassword: config.gmailAppPassword, from: config.EMAIL_FROM }) : undefined); // undefined -> logging transport
  const emailService = createEmailService({ config, transport: emailTransport });
  const authService = createAuthService({ emailService });
  const orchestrator = createOrchestrator({ registry });
  const runner = createTaskRunner({ registry, ai, research, orchestrator, config });
  const worker = createTaskWorker({ runner, config });

  return { config, registry, ai, research, emailService, authService, orchestrator, runner, worker };
}
