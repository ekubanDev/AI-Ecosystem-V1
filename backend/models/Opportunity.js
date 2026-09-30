import "./plugins.js";
import mongoose from "mongoose";
import {
  BUSINESS_MODEL_TYPES, CONFIDENCE, EVIDENCE_TYPES, LEVEL3, OPPORTUNITY_STATUSES, SEVERITY, STRENGTH,
} from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;
const str = { type: String, trim: true };

const schema = new mongoose.Schema(
  {
    name: { ...str, required: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true },
    category: { ...str, maxlength: 100 },
    description: { ...str, maxlength: 5000 },
    sourceIds: [{ type: ObjectId, ref: "Source" }],

    targetCustomer: { segment: str, businessType: str, geography: str },

    problem: { ...str, maxlength: 5000 },
    proposedSolution: { ...str, maxlength: 5000 },

    businessModel: {
      type: { type: String, enum: BUSINESS_MODEL_TYPES },
      revenueMechanism: str,
    },

    pricing: {
      minimum: { type: Number, min: 0 },
      maximum: { type: Number, min: 0 },
      currency: { ...str, uppercase: true, maxlength: 8 },
      pricingEvidence: str,
    },

    acquisitionChannels: [String],
    retentionMechanism: str,

    demandSignals: [
      {
        _id: false,
        source: str,
        observation: str,
        evidence: str,
        strength: { type: String, enum: STRENGTH, default: "UNKNOWN" },
      },
    ],

    competitors: [{ type: ObjectId, ref: "Competitor" }],

    differentiation: [{ _id: false, idea: str, rationale: str, geography: str }],

    economics: {
      estimatedCAC: Number,
      estimatedLTV: Number,
      estimatedARPU: Number,
      estimatedMargin: Number,
      confidence: { type: String, enum: CONFIDENCE, default: "UNKNOWN" },
      basis: str, // how the estimate was derived; estimates without a basis are not stored
    },

    complexity: {
      technical: { type: String, enum: LEVEL3 },
      operational: { type: String, enum: LEVEL3 },
      capital: { type: String, enum: LEVEL3 },
    },

    risks: [{ _id: false, category: str, description: str, severity: { type: String, enum: SEVERITY } }],

    evidence: [
      {
        _id: false,
        claim: { ...str, required: true },
        sourceId: { type: ObjectId, ref: "Source" },
        evidenceType: { type: String, enum: EVIDENCE_TYPES, default: "UNKNOWN" },
        confidence: { type: String, enum: CONFIDENCE, default: "UNKNOWN" },
        area: str, // market | customer | pricing | competitor | businessModel | initial
      },
    ],

    hypotheses: [
      {
        _id: false,
        statement: str,
        status: { type: String, enum: ["UNTESTED", "SUPPORTED", "REFUTED", "INCONCLUSIVE"], default: "UNTESTED" },
      },
    ],

    validationPlan: { objective: str, method: str, budget: { type: Number, min: 0 }, successCriteria: str },

    // Additions to the spec'd model: agent analysis output and the uncertainties/assumptions the spec requires us to keep.
    analysis: { type: Mixed },
    analyzedAt: Date,
    uncertainties: [String],
    assumptions: [String],

    status: { type: String, enum: OPPORTUNITY_STATUSES, default: "DISCOVERED", required: true },
    pausedFromStatus: { type: String, enum: OPPORTUNITY_STATUSES },
    decision: { action: String, note: String, by: { type: ObjectId, ref: "User" }, at: Date },

    discoveryRunId: { type: ObjectId, ref: "DiscoveryRun" },
    createdBy: { type: ObjectId, ref: "User" },
    approvedBy: { type: ObjectId, ref: "User" },
    approvedAt: Date,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true }
);

schema.index({ category: 1, status: 1 });
schema.index({ "targetCustomer.geography": 1 });
schema.index({ status: 1, createdAt: -1 });
schema.index({ createdBy: 1 });
schema.index({ name: "text", description: "text", problem: "text" });

export const Opportunity = mongoose.model("Opportunity", schema);
