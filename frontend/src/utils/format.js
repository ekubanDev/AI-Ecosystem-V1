export const formatDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export const formatMoney = (n, currency) => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n} ${currency ?? ""}`.trim();
  }
};

export const humanize = (s) => (s ? String(s).toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

export const formatDuration = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export const formatCost = (c) => (c == null ? "not priced" : `$${c.toFixed(4)}`);

export const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** Only http(s) links are rendered as anchors (source URLs originate from the web). */
export const safeHref = (url) => (/^https?:\/\//i.test(url ?? "") ? url : undefined);
