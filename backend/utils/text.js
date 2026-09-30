import crypto from "node:crypto";

export const slugify = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

const STOP = new Set(["the", "a", "an", "of", "for", "and", "ai", "app", "platform", "software", "tool", "tools"]);
export const nameTokens = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !STOP.has(t))
  );

export const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

export const truncate = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : s);

/** Normalizes a URL for dedupe: lowercase host, no fragment, no tracking params, sorted query, no trailing slash. */
export const normalizeUrl = (raw) => {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs are supported");
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$)/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  let out = u.toString();
  if (u.pathname === "/" && !u.search) out = out.replace(/\/$/, "");
  return out;
};
