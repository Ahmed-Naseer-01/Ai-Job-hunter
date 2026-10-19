import { createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let counter = 0;
/** Time-sortable unique id (ms timestamp + counter + random). */
export function newId(prefix = ""): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const c = (counter++ % 46656).toString(36).padStart(3, "0");
  return `${prefix}${t}${c}${randomBytes(4).toString("hex")}`;
}

export const nowIso = (d = new Date()) => d.toISOString();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Remove secrets/PII-ish patterns from strings that will be logged. */
export function redact(s: string): string {
  return s
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]")
    .replace(/(api[_-]?key|token|secret|password|authorization)(["'\s:=]+)([^\s"',}]+)/gi, "$1$2[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m));
}

export function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!d) return "[redacted]";
  return `${u.slice(0, 1)}***@${d}`;
}
