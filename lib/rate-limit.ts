const store: Map<string, { count: number; resetAt: number }> = new Map();

export const RATE_LIMITS = {
  orders: { max: 5, windowMs: 60_000 },
  general: { max: 60, windowMs: 60_000 },
};

export function checkRateLimit(key: string, limit: { max: number; windowMs: number }): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= limit.max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return '127.0.0.1';
}
