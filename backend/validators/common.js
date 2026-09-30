import { z } from "zod";
import mongoose from "mongoose";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../utils/pagination.js";

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(v)) === v.toLowerCase(), "Invalid id");
export const idParam = z.object({ id: objectId });

const emptyToUndef = (v) => (v === "" ? undefined : v);

export const paginationQuery = z.object({
  page: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).default(1)),
  limit: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT)),
  order: z.preprocess(emptyToUndef, z.enum(["asc", "desc"]).default("desc")),
});

export const optionalStr = (max = 5000) => z.string().trim().max(max).optional();
export const email = z.string().trim().toLowerCase().email().max(254);
export const nonEmpty = (max = 200) => z.string().trim().min(1).max(max);
