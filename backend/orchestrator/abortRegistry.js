/** Process-local registry of running tasks' AbortControllers, so a cancelled workflow can stop in-flight agents. */
const byTask = new Map(); // taskId -> { workflowId, controller }

export const abortRegistry = {
  register: (taskId, workflowId, controller) => byTask.set(String(taskId), { workflowId, controller }),
  unregister: (taskId) => byTask.delete(String(taskId)),
  abortWorkflow(workflowId, reason = "CANCELLED") {
    let n = 0;
    for (const { workflowId: w, controller } of byTask.values()) {
      if (w === workflowId) {
        controller.abort(reason);
        n++;
      }
    }
    return n;
  },
  abortTask(taskId, reason = "CANCELLED") {
    byTask.get(String(taskId))?.controller.abort(reason);
  },
  size: () => byTask.size,
};
