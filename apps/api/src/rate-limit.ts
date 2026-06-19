export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
}

/**
 * Simple in-memory sliding-window limiter, scoped per key (organization id).
 * Good enough for a single-process demo; a multi-instance deployment would back
 * this with Redis or a database table so the count is shared across instances.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
      recent.push(now);
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  };
}
