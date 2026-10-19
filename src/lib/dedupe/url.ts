const TRACKING_PARAMS = new Set([
  "gh_src", "gh_jid_", "lever-source", "lever-origin", "source", "src", "ref", "referrer", "referral", "utm_source", "utm_medium", "utm_campaign",
  "utm_term", "utm_content", "utm_id", "fbclid", "gclid", "mc_cid", "mc_eid", "trk", "trackingid", "refid", "ccuid", "campaignid", "cid", "_hsenc", "_hsmi",
  "ittk", "sid", "gh_jid_x", "jr_id", "jvi",
]);

/** Normalise a job URL so cosmetic variants compare equal. Returns the input trimmed when it isn't a valid URL. */
export function canonicalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  u.hash = "";
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const lk = k.toLowerCase();
    if (TRACKING_PARAMS.has(lk) || lk.startsWith("utm_")) continue;
    keep.push([k, v]);
  }
  keep.sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  u.pathname = path;
  // Keep scheme normalised to https for comparison purposes.
  const s = u.toString().replace(/^http:/, "https:");
  return s.endsWith("/") && u.search === "" && u.pathname === "/" ? s.slice(0, -1) : s;
}
