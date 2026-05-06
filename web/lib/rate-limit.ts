// Best-effort per-IP rate limiter for serverless API routes.
//
// In-memory: each Vercel function instance keeps its own map. Determined
// attackers can spread across instances to multiply their rate, but for
// casual abuse / single-IP DoS this is effective and zero-cost.
//
// For real production rate limiting we'd swap in Upstash Redis or Vercel KV
// without changing the call site.

const buckets = new Map<string, number[]>();

const MAX_KEYS = 5_000;
const SWEEP_EVERY = 1_000;
let counter = 0;

export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Returns true if the request is allowed; false if it should be 429'd.
 * `key` is typically `"<scope>:<ip>"`.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = buckets.get(key) ?? [];
  const recent = list.filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);

  // Lazy sweep so we don't leak unbounded keys over time.
  if (++counter % SWEEP_EVERY === 0 && buckets.size > MAX_KEYS) {
    const cutoff = now - 5 * 60_000;
    for (const [k, v] of buckets) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) buckets.delete(k);
      else buckets.set(k, live);
    }
  }
  return true;
}
