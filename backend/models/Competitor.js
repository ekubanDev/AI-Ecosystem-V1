import "./plugins.js";
import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true },
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true }, // normalized name for upsert/dedupe
    website: String,
    customerSegment: String,
    geography: String,
    products: [String],
    pricing: String,
    businessModel: String,
    acquisitionChannels: [String],
    strengths: [String],
    weaknesses: [String],
    customerComplaints: [String],
    differentiationOpportunities: [String],
    evidenceIds: [{ type: ObjectId, ref: "Source" }],
  },
  { timestamps: true }
);
schema.index({ opportunityId: 1, name: 1 });
schema.index({ opportunityId: 1, nameKey: 1 }, { unique: true });

export const Competitor = mongoose.model("Competitor", schema);
