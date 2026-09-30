import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "./errors.js";
import { isPrivateAddress } from "./net.js";

const UA = "AIBusinessFactoryBot/0.1 (research)";
const TEXT_TYPES = /^(text\/(html|plain)|application\/(xhtml\+xml|json))/i;

export async function assertPublicUrl(raw, lookup = dns.lookup) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid URL.");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new AppError("VALIDATION_ERROR", "Only http(s) URLs may be fetched.");
  if (u.username || u.password) throw new AppError("VALIDATION_ERROR", "URLs with credentials are not allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new AppError("EXTERNAL_SERVICE_ERROR", `Could not resolve ${host}.`, { retryable: false });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new AppError("FORBIDDEN", "Refusing to fetch a private or reserved address.");
  return u;
}

/**
 * Fetches a public web page as text with SSRF protection: http(s) only, every hop (including redirects) is resolved
 * and checked against private/reserved ranges, bounded size and time. Residual risk: DNS rebinding between our
 * lookup and the socket connect; run the API in a network segment without access to internal services.
 */
export async function safeFetchText(url, { timeoutMs = 10000, maxBytes = 1_000_000, maxRedirects = 3, signal, lookup, fetchImpl = fetch } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(current, lookup);
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    let res;
    try {
      res = await fetchImpl(u, { redirect: "manual", signal: AbortSignal.any(signals), headers: { "user-agent": UA, accept: "text/html,text/plain;q=0.9" } });
    } catch (err) {
      throw new AppError("EXTERNAL_SERVICE_ERROR", `Fetch failed: ${err.name === "TimeoutError" ? "timeout" : err.message}`, { retryable: true, cause: err });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), u).toString();
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError("EXTERNAL_SERVICE_ERROR", `Fetch returned HTTP ${res.status}.`, { retryable: res.status >= 500 || res.status === 429 });
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!TEXT_TYPES.test(contentType)) {
      await res.body?.cancel();
      throw new AppError("EXTERNAL_SERVICE_ERROR", `Unsupported content type: ${contentType || "unknown"}.`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
        break; // truncate rather than fail: the start of a page is what we need
      }
      chunks.push(chunk);
    }
    return { finalUrl: u.toString(), contentType, body: Buffer.concat(chunks).toString("utf8") };
  }
  throw new AppError("EXTERNAL_SERVICE_ERROR", "Too many redirects.");
}
