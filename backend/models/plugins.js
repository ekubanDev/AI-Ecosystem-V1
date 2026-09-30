import mongoose from "mongoose";

// Every API resource serializes with `id` (not `_id`/`__v`). Schemas that define their own toJSON (User) are left alone.
mongoose.plugin((schema) => {
  if (schema.get("toJSON")) return;
  schema.set("toJSON", {
    transform: (_doc, ret) => {
      if (ret._id !== undefined) ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  });
});
