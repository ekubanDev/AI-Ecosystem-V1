import "./plugins.js";
import mongoose from "mongoose";
import { RUN_STATUSES } from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    taskId: { type: ObjectId, ref: "AgentTask", required: true, index: true },
    agentType: { type: String, required: true },
    model: String,
    input: Mixed,
    output: Mixed,
    sourcesUsed: [{ type: ObjectId, ref: "Source" }],
    tokenUsage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
    estimatedCost: { type: Number, default: null }, // USD; null when no pricing is configured
    durationMs: Number,
    status: { type: String, enum: RUN_STATUSES, default: "STARTED", required: true },
    error: String,
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true }
);
schema.index({ agentType: 1, status: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

export const AgentRun = mongoose.model("AgentRun", schema);
