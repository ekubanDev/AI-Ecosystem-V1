export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Builds a Mongo sort object from a whitelist of fields. */
export const buildSort = (sortBy, order, allowed, fallback = "createdAt") => {
  const field = allowed.includes(sortBy) ? sortBy : fallback;
  return { [field]: order === "asc" ? 1 : -1, _id: order === "asc" ? 1 : -1 };
};

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
