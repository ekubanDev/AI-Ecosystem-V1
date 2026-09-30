import "./plugins.js";
import mongoose from "mongoose";
import { ROLES } from "./constants.js";

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "VIEWER", required: true },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String },
    emailVerificationExpiresAt: { type: Date },
    passwordResetTokenHash: { type: String },
    passwordResetExpiresAt: { type: Date },
    refreshTokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
schema.index({ emailVerificationTokenHash: 1 }, { sparse: true });
schema.index({ passwordResetTokenHash: 1 }, { sparse: true });

// Secrets never serialize: this transform is the guard for every response path. (Not using select:false: it would also add
// projections to findOneAndUpdate, which some MongoDB-compatible servers used for local development reject.)
const PRIVATE = ["passwordHash", "emailVerificationTokenHash", "emailVerificationExpiresAt", "passwordResetTokenHash", "passwordResetExpiresAt", "refreshTokenVersion"];
schema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    for (const k of PRIVATE) delete ret[k];
    return ret;
  },
});

export const User = mongoose.model("User", schema);
