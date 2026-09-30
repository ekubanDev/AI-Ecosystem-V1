import "./plugins.js";
import mongoose from "mongoose";

const { Mixed } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    scope: { type: String, required: true }, // userId + method + route
    requestHash: { type: String, required: true },
    state: { type: String, enum: ["IN_PROGRESS", "COMPLETED"], default: "IN_PROGRESS" },
    responseStatus: Number,
    responseBody: Mixed,
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 }, // TTL: 24h
  },
  { versionKey: false }
);
schema.index({ scope: 1, key: 1 }, { unique: true });

export const IdempotencyKey = mongoose.model("IdempotencyKey", schema);
