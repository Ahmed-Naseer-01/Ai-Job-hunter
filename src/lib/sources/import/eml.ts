/**
 * Parse a saved job-alert email (.eml). Pure text processing: nothing in the message is executed or fetched.
 * We pull the subject/date and the job links (with their anchor text); the user opens links themselves.
 */
export interface ParsedEmail {
  subject: string;
  from: string;
  date: string | null;
  html: string;
  text: string;
}

function unfold(headerBlock: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = headerBlock.replace(/\r\n/g, "\n").split("\n");
  let cur = "";
  const flush = () => {
    const i = cur.indexOf(":");
    if (i > 0) out[cur.slice(0, i).trim().toLowerCase()] = cur.slice(i + 1).trim();
    cur = "";
  };
  for (const l of lines) {
    if (/^[ \t]/.test(l)) cur += " " + l.trim();
    else {
      flush();
      cur = l;
    }
  }
  flush();
  return out;
}

export function decodeQuotedPrintable(s: string): string {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function bytesToString(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(/^(utf-?8|us-ascii)$/i.test(charset) || !charset ? "utf-8" : charset, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function decodeBody(body: string, encoding: string | undefined, charset: string): string {
  const enc = (encoding ?? "").toLowerCase();
  if (enc === "base64") return bytesToString(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
  if (enc === "quoted-printable") {
    const bin = decodeQuotedPrintable(body);
    return bytesToString(Buffer.from(bin, "latin1"), charset);
  }
  return body;
}

/** RFC 2047 encoded-words in headers, e.g. =?UTF-8?B?...?= or =?UTF-8?Q?...?= */
export function decodeHeader(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    if (enc.toUpperCase() === "B") return bytesToString(Buffer.from(data, "base64"), charset);
    return bytesToString(Buffer.from(decodeQuotedPrintable(data.replace(/_/g, " ")), "latin1"), charset);
  }).replace(/\?=\s+=\?/g, "");
}

interface Part {
  headers: Record<string, string>;
  body: string;
}
function splitMessage(raw: string): Part {
  const norm = raw.replace(/\r\n/g, "\n");
  const i = norm.indexOf("\n\n");
  return i < 0 ? { headers: unfold(norm), body: "" } : { headers: unfold(norm.slice(0, i)), body: norm.slice(i + 2) };
}

function collect(part: Part, acc: { html: string[]; text: string[] }, depth = 0) {
  if (depth > 6) return;
  const ct = part.headers["content-type"] ?? "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  const charset = /charset="?([^";\s]+)"?/i.exec(ct)?.[1] ?? "utf-8";
  if (type.startsWith("multipart/")) {
    const boundary = /boundary="?([^";\s]+)"?/i.exec(ct)?.[1];
    if (!boundary) return;
    const chunks = part.body.split(`--${boundary}`).slice(1);
    for (const c of chunks) {
      if (c.startsWith("--")) break;
      collect(splitMessage(c.replace(/^\n/, "")), acc, depth + 1);
    }
    return;
  }
  if (/attachment/i.test(part.headers["content-disposition"] ?? "")) return; // never open attachments
  const decoded = decodeBody(part.body, part.headers["content-transfer-encoding"], charset);
  if (type === "text/html") acc.html.push(decoded);
  else if (type === "text/plain") acc.text.push(decoded);
}

export function parseEml(raw: string): ParsedEmail {
  if (raw.length > 5_000_000) throw new Error("Email is too large (limit 5 MB)");
  const msg = splitMessage(raw);
  const acc = { html: [] as string[], text: [] as string[] };
  collect(msg, acc);
  return {
    subject: decodeHeader(msg.headers["subject"] ?? ""),
    from: decodeHeader(msg.headers["from"] ?? ""),
    date: msg.headers["date"] && !Number.isNaN(Date.parse(msg.headers["date"])) ? new Date(msg.headers["date"]).toISOString() : null,
    html: acc.html.join("\n"),
    text: acc.text.join("\n"),
  };
}

export interface FoundLink {
  url: string;
  text: string;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Extract anchor links (http/https only) with their visible text from HTML, plus bare URLs from plain text. */
export function extractLinks(html: string, text: string): FoundLink[] {
  const out: FoundLink[] = [];
  const re = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeEntities((m[1] ?? m[2] ?? "").trim());
    if (!/^https?:\/\//i.test(href)) continue; // drops javascript:, data:, mailto:, cid:
    const label = decodeEntities(m[3].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    out.push({ url: href, text: label });
  }
  for (const u of text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []) out.push({ url: u.replace(/[.,;]+$/, ""), text: "" });
  return out;
}
