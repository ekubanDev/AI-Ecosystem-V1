import "./plugins.js";
import mongoose from "mongoose";
import { SOURCE_TYPES, CONFIDENCE } from "./constants.js";

const { ObjectId } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 500 },
    url: { type: String, required: true, unique: true }, // normalized URL
    domain: { type: String, index: true },
    sourceType: { type: String, enum: SOURCE_TYPES, default: "OTHER" },
    retrievedAt: { type: Date, default: Date.now },
    publisher: String,
    publishedAt: Date,
    contentSummary: { type: String, maxlength: 4000 },
    reliability: { type: String, enum: CONFIDENCE, default: "UNKNOWN" },
    contentHash: { type: String, index: true, sparse: true },
    opportunityIds: [{ type: ObjectId, ref: "Opportunity" }],
  },
  { timestamps: true }
);

export const Source = mongoose.model("Source", schema);
