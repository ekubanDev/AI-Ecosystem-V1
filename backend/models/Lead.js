import "./plugins.js";
import mongoose from "mongoose";
import { LEAD_STATUSES } from "./constants.js";

const { ObjectId } = mongoose.Schema.Types;
const str = (max) => ({ type: String, trim: true, maxlength: max });

/** A person who left their details on an opportunity's public landing page. Personal data: see the leads:* capabilities. */
const schema = new mongoose.Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true, index: true },
    name: { ...str(120), required: true },
    email: { ...str(254), required: true, lowercase: true },
    phone: str(40),
    company: str(150),
    sector: str(100),
    message: str(1000),
    source: str(100), // e.g. a utm_source / referrer tag, for judging which channel produced demand
    // The exact wording the person agreed to is stored with the time, so consent can be demonstrated later.
    consent: { text: { type: String, required: true }, at: { type: Date, required: true } },
    status: { type: String, enum: LEAD_STATUSES, default: "NEW", required: true },
    notes: str(2000),
  },
  { timestamps: true }
);
schema.index({ opportunityId: 1, email: 1 }, { unique: true }); // a resubmission is the same lead, not a second signup
schema.index({ opportunityId: 1, createdAt: -1 });

export const Lead = mongoose.model("Lead", schema);
