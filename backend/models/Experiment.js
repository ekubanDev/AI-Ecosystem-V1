import "./plugins.js";
import mongoose from "mongoose";
import { EXPERIMENT_STATUSES } from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    hypothesis: { type: String, required: true, trim: true },
    objective: String,
    method: String,
    targetCustomer: String,
    budget: { type: Number, min: 0, default: 0 },
    currency: { type: String, uppercase: true, maxlength: 8 },
    startDate: Date,
    endDate: Date,
    metrics: [{ _id: false, name: { type: String, required: true }, target: Mixed, actual: Mixed }],
    successCriteria: String,
    results: String,
    conclusion: String,
    nextAction: String,
    status: { type: String, enum: EXPERIMENT_STATUSES, default: "DRAFT", required: true },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);
schema.index({ status: 1, createdAt: -1 });

export const Experiment = mongoose.model("Experiment", schema);
