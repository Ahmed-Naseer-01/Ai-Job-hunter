import { sleep as realSleep } from "../util";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Server-requested wait (from Retry-After) in ms, if any. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RetryExhaustedError";
  }
}

/** Transient = network error, timeout, 408, 425, 429, 5xx. Everything else is permanent. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500;
  if (e instanceof RetryExhaustedError) return false;
  if (e && typeof e === "object") {
    // Provider/SDK errors (SMTP, Resend, ...) that expose an HTTP-like or SMTP status.
    const st = (e as any).status ?? (e as any).statusCode;
    if (typeof st === "number") return st === 408 || st === 425 || st === 429 || st >= 500;
    const rc = (e as any).responseCode;
    if (typeof rc === "number") return rc >= 400 && rc < 500; // SMTP 4xx = temporary
    const code = (e as any).code;
    if (typeof code === "string" && /^(ECONNECTION|ETIMEDOUT|ESOCKET|EDNS|ECONNRESET|ECONNREFUSED|EAI_AGAIN)$/.test(code)) return true;
  }
  if (e instanceof Error) return e.name === "AbortError" || e.name === "TimeoutError" || e instanceof TypeError || /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed/i.test(e.message);
  return false;
}

export interface RetryOptions {
  retries: number; // additional attempts after the first
  baseMs: number;
  maxMs: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1 jitter source (injectable for tests). */
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Run `fn`, retrying transient failures with exponential backoff (base * 2^(n-1)), capped at `maxMs`,
 * plus up to 25% jitter (never exceeding the cap). Honours Retry-After but never waits longer than `maxMs`.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<{ value: T; attempts: number }> {
  const sleep = o.sleep ?? realSleep;
  const random = o.random ?? Math.random;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (e) {
      const status = e instanceof HttpError ? e.status : undefined;
      if (!isRetryable(e) || attempt > o.retries) {
        throw new RetryExhaustedError(e instanceof Error ? e.message : String(e), attempt, e, status);
      }
      const backoff = Math.min(o.maxMs, o.baseMs * 2 ** (attempt - 1));
      const wanted = e instanceof HttpError && e.retryAfterMs ? Math.max(backoff, e.retryAfterMs) : backoff;
      const delay = Math.min(o.maxMs, Math.round(wanted + random() * 0.25 * wanted));
      o.onRetry?.({ attempt, delayMs: delay, error: e });
      await sleep(delay);
    }
  }
}
