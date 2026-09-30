import "./plugins.js";
import mongoose from "mongoose";
import { CONFIDENCE, EVIDENCE_TYPES } from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true, unique: true },
    customer: String,
    problem: String,
    valueProposition: String,
    product: String,
    acquisition: String,
    conversion: String,
    pricing: String,
    revenueModel: String,
    delivery: String,
    retention: String,
    upsell: String,
    referral: String,
    operationalDependencies: [String],
    technologyDependencies: [String],
    // Per-field evidence type (VERIFIED / SUPPORTED / ESTIMATED / INFERRED / ASSUMED / UNKNOWN); keeps evidence separate from inference.
    evidenceTypes: { type: Mixed },
    confidence: { type: String, enum: CONFIDENCE, default: "UNKNOWN" },
    generatedByAgent: String,
  },
  { timestamps: true }
);

export { EVIDENCE_TYPES };
export const BusinessModel = mongoose.model("BusinessModel", schema);
