import { AgentRun, AgentTask } from "../models/index.js";
import { AppError, isRetryable } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { audit, AGENT_ACTOR } from "../services/auditService.js";
import { abortRegistry } from "./abortRegistry.js";

const backoff = (config, retryCount) => Math.min(config.RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1), 5 * 60 * 1000);
const trim = (s) => String(s ?? "").slice(0, 2000);

/**
 * Builds the capability set an agent may use. Agents never receive raw database or network access:
 * they get the AI service (usage-tracked) and, only if their declared permissions include it, search/fetch.
 */
export function createAgentContext({ agent, ai, research, signal, tracker }) {
  const ctx = {
    signal,
    ai: {
      async generateJSON(opts) {
        const res = await ai.generateJSON({ ...opts, signal });
        tracker.calls.push({ model: res.model, usage: res.usage });
        return res;
      },
    },
  };
  const ext = agent.permissions.external;
  if (research && (ext.includes("search") || ext.includes("fetch"))) {
    ctx.research = { searchAvailable: research.searchAvailable && ext.includes("search") };
    if (ext.includes("search")) {
      ctx.research.search = async (q, o) => {
        const rs = await research.search(q, { ...o, signal });
        rs.forEach((r) => tracker.sourceIds.add(r.sourceId));
        return rs;
      };
    }
    if (ext.includes("fetch")) {
      ctx.research.fetchPage = async (url, o) => {
        const page = await research.fetchPage(url, { ...o, signal });
        if (page) tracker.sourceIds.add(page.sourceId);
        return page;
      };
    }
  }
  return ctx;
}

export function createTaskRunner({ registry, ai, research, orchestrator, config }) {
  const inFlight = new Set();

  async function settleFailure(task, err, run) {
    const retryable = isRetryable(err);
    const message = trim(err.message);
    if (run) {
      await AgentRun.updateOne({ _id: run._id }, { $set: { status: "FAILED", error: message, completedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime() } });
      await audit({ actor: AGENT_ACTOR(task.agentType), action: "AGENT_RUN_FAILED", resourceType: "AgentRun", resourceId: run._id, metadata: { taskId: String(task._id), error: message } });
    }
    const failed = await AgentTask.findOneAndUpdate(
      { _id: task._id, status: "RUNNING" }, { $set: { status: "FAILED", error: message, errorType: err.code ?? err.name, completedAt: new Date() } }, { returnDocument: "after" }
    );
    if (!failed) return; // cancelled / already settled elsewhere
    await audit({ actor: AGENT_ACTOR(task.agentType), action: "AGENT_TASK_FAILED", resourceType: "AgentTask", resourceId: task._id, metadata: { errorType: err.code ?? err.name, error: message, retryCount: failed.retryCount, retryable } });

    if (retryable && failed.retryCount < config.MAX_AGENT_RETRIES) {
      const retrying = await AgentTask.findOneAndUpdate({ _id: task._id, status: "FAILED" }, { $set: { status: "RETRYING" }, $inc: { retryCount: 1 } }, { returnDocument: "after" });
      await audit({ actor: { type: "SYSTEM" }, action: "AGENT_TASK_RETRIED", resourceType: "AgentTask", resourceId: task._id, metadata: { attempt: retrying.retryCount, delayMs: backoff(config, retrying.retryCount) } });
      await AgentTask.updateOne(
        { _id: task._id, status: "RETRYING" },
        { $set: { status: "QUEUED", runAfter: new Date(Date.now() + backoff(config, retrying.retryCount)) }, $unset: { startedAt: 1, completedAt: 1 } }
      );
      return;
    }
    if (retryable) await AgentTask.updateOne({ _id: task._id, status: "FAILED" }, { $set: { status: "WAITING_REVIEW" } }); // retries exhausted: a human decides
    await orchestrator.onTaskTerminalFailure(task);
    await orchestrator.refreshRun(task.workflowId);
  }

  const runner = {
    inFlight: () => inFlight.size,

    /** Executes a task that has already been claimed (status RUNNING). Never throws. */
    async execute(task) {
      inFlight.add(String(task._id));
      const controller = new AbortController();
      abortRegistry.register(task._id, task.workflowId, controller);
      const timer = setTimeout(() => controller.abort(new AppError("AGENT_TIMEOUT", `Agent exceeded ${config.AGENT_TIMEOUT_MS}ms.`, { retryable: true })), config.AGENT_TIMEOUT_MS);
      const tracker = { calls: [], sourceIds: new Set() };
      let run;
      let output;
      try {
        await orchestrator.onTaskStarted(task);
        const agent = registry.get(task.agentType);
        run = await AgentRun.create({ taskId: task._id, agentType: task.agentType, input: task.input, model: ai.model });
        await audit({ actor: AGENT_ACTOR(task.agentType), action: "AGENT_RUN_STARTED", resourceType: "AgentRun", resourceId: run._id, metadata: { taskId: String(task._id) } });

        const ctx = createAgentContext({ agent, ai, research, signal: controller.signal, tracker });
        const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
        const work = agent.run(task.input, ctx);
        work.catch(() => {}); // if the abort wins the race, don't leave an unhandled rejection behind
        output = await Promise.race([work, aborted]);

        await orchestrator.onTaskSucceeded(task, output, agent);

        const usage = tracker.calls.reduce((a, c) => ({ inputTokens: a.inputTokens + c.usage.inputTokens, outputTokens: a.outputTokens + c.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
        const done = await AgentTask.findOneAndUpdate({ _id: task._id, status: "RUNNING" }, { $set: { status: "COMPLETED", completedAt: new Date() } }, { returnDocument: "after" });
        await AgentRun.updateOne(
          { _id: run._id },
          {
            $set: {
              status: done ? "COMPLETED" : "CANCELLED", output, completedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime(),
              model: tracker.calls[0]?.model ?? ai.model, sourcesUsed: [...new Set([...tracker.sourceIds, ...(output.sources ?? [])])],
              tokenUsage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens }, estimatedCost: ai.estimateCost(usage),
            },
          }
        );
        if (done) {
          await audit({ actor: AGENT_ACTOR(task.agentType), action: "AGENT_RUN_COMPLETED", resourceType: "AgentRun", resourceId: run._id, metadata: { taskId: String(task._id), confidence: output.confidence } });
          await audit({ actor: AGENT_ACTOR(task.agentType), action: "AGENT_TASK_COMPLETED", resourceType: "AgentTask", resourceId: task._id });
        }
        await orchestrator.refreshRun(task.workflowId);
      } catch (err) {
        try {
          if (controller.signal.reason === "CANCELLED") {
            await AgentTask.updateOne({ _id: task._id, status: "RUNNING" }, { $set: { status: "CANCELLED", completedAt: new Date() } });
            if (run) await AgentRun.updateOne({ _id: run._id }, { $set: { status: "CANCELLED", completedAt: new Date() } });
            await orchestrator.refreshRun(task.workflowId);
          } else {
            const failure = controller.signal.aborted && controller.signal.reason instanceof AppError ? controller.signal.reason : err;
            if (run && output) await AgentRun.updateOne({ _id: run._id }, { $set: { output } });
            await settleFailure(task, failure, run);
          }
        } catch (inner) {
          logger.error("failed to record task failure", { taskId: String(task._id), err: inner });
        }
      } finally {
        clearTimeout(timer);
        abortRegistry.unregister(task._id);
        inFlight.delete(String(task._id));
      }
    },

    /** Atomically claims the next runnable task (highest priority first, then oldest). */
    async claimNext() {
      const task = await AgentTask.findOneAndUpdate(
        { status: "QUEUED", runAfter: { $lte: new Date() } },
        { $set: { status: "RUNNING", startedAt: new Date() }, $unset: { error: 1, errorType: 1 } },
        { sort: { priorityRank: -1, createdAt: 1 }, returnDocument: "after" }
      );
      if (task) await audit({ actor: AGENT_ACTOR(task.agentType), action: "AGENT_TASK_STARTED", resourceType: "AgentTask", resourceId: task._id, metadata: { workflow: task.workflow, attempt: task.retryCount + 1 } });
      return task;
    },

    /** Tasks stuck in RUNNING (process crashed mid-run) are failed as transient so the normal retry policy applies. */
    async recoverStale() {
      const cutoff = new Date(Date.now() - config.AGENT_TIMEOUT_MS * 2);
      const stale = await AgentTask.find({ status: "RUNNING", startedAt: { $lt: cutoff } });
      for (const task of stale) {
        if (inFlight.has(String(task._id))) continue;
        const run = await AgentRun.findOne({ taskId: task._id, status: "STARTED" }).sort({ createdAt: -1 });
        await settleFailure(task, new AppError("AGENT_ERROR", "Worker stopped before the task finished.", { retryable: true }), run);
      }
      return stale.length;
    },
  };
  return runner;
}
