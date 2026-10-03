import "./plugins.js";
import mongoose from "mongoose";
import { CONFIDENCE, EVIDENCE_TYPES } from "./constants.js";

const { ObjectId } = mongoose.Schema.Types;
const str = { type: String, trim: true };

/** The Business Architect's plan for one approved opportunity. A plan to test, never evidence that the business works. */
const schema = new mongoose.Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true, unique: true },
    positioning: str,
    brandOptions: [{ _id: false, name: str, rationale: str }],
    offer: { whatYouSell: str, howDelivered: str },
    pricingHypotheses: [{ _id: false, tier: str, price: Number, currency: str, unit: str, basis: str, evidenceType: { type: String, enum: EVIDENCE_TYPES } }],
    mvpScope: { mustHave: [str], niceToHave: [str], notNow: [str] },
    manualFirstPlan: [str],
    launchChecklist: [{ _id: false, item: str, requiresHumanApproval: Boolean }],
    validationGates: [str],
    localizationNotes: [str],
    risksAndMitigations: [{ _id: false, risk: str, mitigation: str }],
    assumptions: [str],
    uncertainties: [str],
    confidence: { type: String, enum: CONFIDENCE, default: "UNKNOWN" },
    generatedByAgent: str,
    version: { type: Number, default: 1 }, // incremented each time the blueprint is regenerated
  },
  { timestamps: true }
);

export const Blueprint = mongoose.model("Blueprint", schema);
