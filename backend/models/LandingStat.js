import "./plugins.js";
import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

/**
 * Page-view counters for a published landing page, one row per opportunity, UTC day and traffic source.
 * Counters only: no IP address, user agent, cookie or visitor id is stored, so nothing here is personal data.
 * The price of that: views cannot be told apart by visitor, so a refresh counts again and bots are included.
 */
const schema = new mongoose.Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // UTC, e.g. 2026-10-03
    source: { type: String, default: "", maxlength: 100 }, // utm_source / referrer tag, "" when none
    views: { type: Number, default: 0, min: 0 },
    lastViewAt: Date,
  },
  { timestamps: false }
);
schema.index({ opportunityId: 1, day: 1, source: 1 }, { unique: true });

export const LandingStat = mongoose.model("LandingStat", schema);
