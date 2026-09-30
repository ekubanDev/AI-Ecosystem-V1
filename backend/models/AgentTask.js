import "./plugins.js";
import mongoose from "mongoose";
import { AGENT_TYPES, PRIORITY_RANK, TASK_PRIORITIES, TASK_STATUSES } from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    agentType: { type: String, enum: AGENT_TYPES, required: true },
    workflowId: { type: String, required: true },
    workflow: { type: String, required: true }, // DISCOVERY | ANALYSIS | MANUAL
    objective: String,
    input: Mixed,
    outputSchema: Mixed,
    priority: { type: String, enum: TASK_PRIORITIES, default: "NORMAL" },
    priorityRank: { type: Number, default: PRIORITY_RANK.NORMAL },
    status: { type: String, enum: TASK_STATUSES, default: "QUEUED", required: true },
    requestedBy: { type: ObjectId, ref: "User" },
    opportunityId: { type: ObjectId, ref: "Opportunity" },
    startedAt: Date,
    completedAt: Date,
    runAfter: { type: Date, default: Date.now }, // backoff: not claimable before this time
    retryCount: { type: Number, default: 0 },
    error: String,
    errorType: String,
    // Guards against creating the same chain step twice (workflowId:agentType:opportunityId).
    dedupeKey: { type: String },
  },
  { timestamps: true }
);

schema.pre("validate", function () {
  this.priorityRank = PRIORITY_RANK[this.priority] ?? PRIORITY_RANK.NORMAL;
});

schema.index({ status: 1, priority: 1, createdAt: 1 });
schema.index({ status: 1, runAfter: 1, priorityRank: -1, createdAt: 1 });
schema.index({ workflowId: 1, agentType: 1 });
schema.index({ opportunityId: 1, status: 1 });
schema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export const AgentTask = mongoose.model("AgentTask", schema);
