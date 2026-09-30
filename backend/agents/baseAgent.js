import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { zodDetails } from "../middleware/validate.js";

/**
 * Common agent interface (Technical Specification §17). Subclasses define metadata, input/output schemas,
 * declared permissions and `execute()`. Permissions are enforced in software by taskRunner.createAgentContext
 * (external capabilities) and orchestrator persistence (write kinds).
 */
export class BaseAgent {
  /**
   * @param {object} config
   * @param {string} config.agentType   AGENT_TYPES value
   * @param {string} config.name
   * @param {string} config.version
   * @param {string} config.description
   * @param {string} config.objective
   * @param {z.ZodType} config.inputSchema
   * @param {z.ZodType} config.outputSchema
   * @param {{read: string[], write: string[], external: Array<'search'|'fetch'>}} config.permissions
   */
  constructor(config) {
    Object.assign(this, config);
  }

  get inputJsonSchema() {
    const s = z.toJSONSchema(this.inputSchema);
    delete s.$schema;
    return s;
  }

  /** @returns {Promise<object>} output matching outputSchema */
  async execute(_input, _ctx) {
    throw new Error("execute() must be implemented");
  }

  parseInput(raw) {
    const r = this.inputSchema.safeParse(raw ?? {});
    if (!r.success) throw new AppError("VALIDATION_ERROR", `${this.name}: invalid input.`, { details: zodDetails(r.error) });
    return r.data;
  }

  validateOutput(output) {
    const r = this.outputSchema.safeParse(output);
    if (!r.success) throw new AppError("AGENT_ERROR", `${this.name}: produced output that violates its contract.`, { details: zodDetails(r.error) });
    return r.data;
  }

  async run(rawInput, ctx) {
    const input = this.parseInput(rawInput);
    return this.validateOutput(await this.execute(input, ctx));
  }

  describe() {
    return {
      agentType: this.agentType, name: this.name, version: this.version, description: this.description,
      objective: this.objective, permissions: this.permissions, inputSchema: this.inputJsonSchema,
    };
  }
}
