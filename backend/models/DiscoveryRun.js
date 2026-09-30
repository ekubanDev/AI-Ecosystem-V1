import "./plugins.js";
import mongoose from "mongoose";
import { DISCOVERY_RUN_STATUSES } from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Tracks one execution of the DISCOVERY workflow. (Addition to the spec's collection list: /api/discovery/runs needs a run record.)
const schema = new mongoose.Schema(
  {
    request: { type: Mixed, required: true },
    status: { type: String, enum: DISCOVERY_RUN_STATUSES, default: "QUEUED", required: true },
    stage: { type: String, default: "DISCOVERING" },
    stats: {
      candidates: { type: Number, default: 0 },
      duplicatesSkipped: { type: Number, default: 0 },
      opportunitiesCreated: { type: Number, default: 0 },
      opportunitiesCompleted: { type: Number, default: 0 },
      opportunitiesFailed: { type: Number, default: 0 },
      opportunitiesSkipped: { type: Number, default: 0 }, // paused/rejected/deleted mid-pipeline
    },
    opportunityIds: [{ type: ObjectId, ref: "Opportunity" }],
    error: String,
    requestedBy: { type: ObjectId, ref: "User" },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);
schema.index({ createdAt: -1 });
schema.index({ status: 1, createdAt: -1 });

export const DiscoveryRun = mongoose.model("DiscoveryRun", schema);
