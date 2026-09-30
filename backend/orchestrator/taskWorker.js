import { logger } from "../utils/logger.js";

/** Polls the AgentTask collection (the durable queue) and runs tasks with bounded concurrency. Redis/BullMQ can replace this later. */
export function createTaskWorker({ runner, config }) {
  let timer;
  let recoverTimer;
  let running = false;
  const active = new Set();

  const fill = async () => {
    while (running && active.size < config.WORKER_CONCURRENCY) {
      const task = await runner.claimNext().catch((err) => {
        logger.error("claim failed", { err });
        return null;
      });
      if (!task) return;
      const p = runner.execute(task).finally(() => {
        active.delete(p);
        if (running) setImmediate(() => fill().catch(() => {})); // pick up newly queued follow-up tasks promptly
      });
      active.add(p);
    }
  };

  return {
    async start() {
      running = true;
      await runner.recoverStale().catch((err) => logger.error("stale recovery failed", { err }));
      timer = setInterval(() => fill().catch((err) => logger.error("worker tick failed", { err })), config.WORKER_POLL_MS);
      recoverTimer = setInterval(() => runner.recoverStale().catch(() => {}), 60000);
      timer.unref?.();
      recoverTimer.unref?.();
      fill().catch(() => {});
      logger.info("task worker started", { concurrency: config.WORKER_CONCURRENCY });
    },

    /** Stops claiming new work and waits for in-flight tasks. */
    async stop() {
      running = false;
      clearInterval(timer);
      clearInterval(recoverTimer);
      await Promise.allSettled([...active]);
    },

    /** Runs claimable tasks to completion, one at a time, until the queue is empty. Used by tests and one-off scripts. */
    async drain({ maxTasks = 1000 } = {}) {
      let n = 0;
      while (n < maxTasks) {
        const task = await runner.claimNext();
        if (!task) break;
        await runner.execute(task);
        n++;
      }
      return n;
    },
  };
}
