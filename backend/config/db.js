import mongoose from "mongoose";
import { allModels } from "../models/index.js";
import { logger } from "../utils/logger.js";

export async function connectDb(config) {
  mongoose.set("strictQuery", true);
  mongoose.set("autoIndex", config.autoIndex);
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await ensureIndexes(config);
  logger.info("MongoDB connected", { db: mongoose.connection.name });
}

/** Builds indexes. Uniqueness (users.email, sources.url, ...) is a correctness requirement, so production fails fast. */
export async function ensureIndexes(config) {
  const results = await Promise.allSettled(allModels.map((m) => m.init()));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const msg = `Index build failed for ${allModels[i].modelName}: ${r.reason?.message}`;
      if (config.isProd) throw new Error(msg);
      logger.warn(msg);
    }
  });
}

export const disconnectDb = () => mongoose.disconnect();
