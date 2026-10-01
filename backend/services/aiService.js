import OpenAI from "openai";
import { z } from "zod";
import { AppError } from "../utils/errors.js";

/** OpenAI chat-completions provider. Returns { text, usage, model }. */
export function createOpenAIProvider({ apiKey, timeoutMs = 120000 }) {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 }); // retries are owned by the task runner
  return {
    name: "openai",
    async complete({ system, prompt, model, signal }) {
      try {
        const res = await client.chat.completions.create(
          { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], response_format: { type: "json_object" } },
          { signal }
        );
        return {
          text: res.choices[0]?.message?.content ?? "",
          model: res.model ?? model,
          usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        };
      } catch (err) {
        if (signal?.aborted) throw err;
        const status = err?.status;
        const transient = status === undefined || status === 408 || status === 409 || status >= 500 || (status === 429 && err.code !== "insufficient_quota");
        throw new AppError("EXTERNAL_SERVICE_ERROR", `OpenAI request failed${status ? ` (HTTP ${status})` : ""}: ${err.message}`, { retryable: transient, cause: err });
      }
    },
  };
}

const stripFences = (t) => t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export function createAIService({ config, provider }) {
  const cost = (u) =>
    config.AI_PRICE_INPUT_PER_MTOK != null && config.AI_PRICE_OUTPUT_PER_MTOK != null
      ? (u.inputTokens * config.AI_PRICE_INPUT_PER_MTOK + u.outputTokens * config.AI_PRICE_OUTPUT_PER_MTOK) / 1e6
      : null;

  return {
    configured: Boolean(provider),
    model: config.OPENAI_MODEL,
    estimateCost: cost,

    /**
     * Calls the model and returns schema-validated JSON. Malformed or non-conforming output is a retryable AGENT_ERROR.
     * @returns {Promise<{data: any, usage: {inputTokens:number,outputTokens:number}, model: string}>}
     */
    async generateJSON({ label, system, prompt, schema, signal }) {
      if (!provider) throw new AppError("EXTERNAL_SERVICE_ERROR", "No AI provider configured (set OPENAI_API_KEY).", { retryable: false });
      const jsonSchema = z.toJSONSchema(schema);
      delete jsonSchema.$schema;
      const fullPrompt = `${prompt}\n\n## OUTPUT JSON SCHEMA\nReturn ONLY a JSON object that validates against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
      const res = await provider.complete({ label, system, prompt: fullPrompt, model: config.OPENAI_MODEL, signal });

      let parsed;
      try {
        parsed = JSON.parse(stripFences(res.text));
      } catch {
        throw new AppError("AGENT_ERROR", `${label}: model returned invalid JSON.`, { retryable: true });
      }
      const check = schema.safeParse(parsed);
      if (!check.success) {
        const issues = check.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
        throw new AppError("AGENT_ERROR", `${label}: model output failed schema validation (${issues.join("; ")}).`, { retryable: true, details: issues }); // issues in the message: it is what AgentRun.error stores, and live failures were undiagnosable without it
      }
      return { data: check.data, usage: res.usage, model: res.model };
    },
  };
}
