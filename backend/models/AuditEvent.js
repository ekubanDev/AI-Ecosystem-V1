import "./plugins.js";
import mongoose from "mongoose";
import { AUDIT_ACTIONS } from "./constants.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const schema = new mongoose.Schema(
  {
    actorId: { type: ObjectId },
    actorType: { type: String, enum: ["USER", "AGENT", "SYSTEM"], required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    resourceType: String,
    resourceId: ObjectId,
    before: Mixed,
    after: Mixed,
    metadata: Mixed,
    ipAddress: String,
    userAgent: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ resourceType: 1, resourceId: 1, createdAt: 1 });
schema.index({ actorId: 1, createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });

// Append-only: block every mutation path except creating new documents.
const blocked = [
  "updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne",
  "deleteOne", "deleteMany", "findOneAndDelete",
];
for (const op of blocked) {
  schema.pre(op, { document: false, query: true }, function () {
    throw new Error("AuditEvent is append-only");
  });
}
schema.pre("save", function () {
  if (!this.isNew) throw new Error("AuditEvent is append-only");
});
schema.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error("AuditEvent is append-only");
});

export const AuditEvent = mongoose.model("AuditEvent", schema);
