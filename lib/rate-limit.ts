/**
 * In-memory sliding-window rate limiter. Edge- and Node-safe (no imports).
 * Suitable for a single-process self-hosted app; on multi-instance deployments
 * each instance keeps its own counters.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 20_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size >= MAX_KEYS) {
      // Drop the oldest entries to keep memory bounded.
      const it = buckets.keys();
      for (let i = 0; i < 1000; i++) {
        const k = it.next().value;
        if (k === undefined) break;
        buckets.delete(k);
      }
    }
    hits = [];
    buckets.set(key, hits);
  }
  while (hits.length && hits[0] <= cutoff) hits.shift();
  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec, limit };
  }
  hits.push(now);
  return { ok: true, remaining: limit - hits.length, retryAfterSec: 0, limit };
}

/** Best-effort client IP (works behind nginx / Vercel). */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'local';
}
