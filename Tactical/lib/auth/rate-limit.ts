/**
 * Best-effort in-memory fixed-window rate limiter for sensitive routes (login,
 * register). Per-process (not durable/cross-instance) — acceptable for login
 * throttling; a shared store can be swapped in later. Keyed by caller identity.
 */
const g = globalThis as unknown as { __vpRate?: Map<string, { count: number; resetAt: number }> }
function store() { return (g.__vpRate ??= new Map()) }

export interface RateResult { allowed: boolean; retryAfterSec: number }

export function rateLimit(key: string, limit: number, windowSec: number): RateResult {
  const now = Date.now()
  const s = store()
  const entry = s.get(key)
  if (!entry || entry.resetAt <= now) {
    s.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return { allowed: true, retryAfterSec: 0 }
  }
  entry.count += 1
  if (entry.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

/**
 * Best-effort client IP. X-Forwarded-For is CLIENT-SUPPLIED and trivially
 * spoofable when the server is reached directly, so it is trusted ONLY behind a
 * declared reverse proxy (TRUSTED_PROXY=true), where we take the right-most hop
 * the proxy appended. Otherwise IP-based limiting collapses to a single coarse
 * bucket and callers should ALSO limit by a non-spoofable dimension (e.g. the
 * target account on login).
 */
export function clientIp(headers: Headers): string {
  if (process.env.TRUSTED_PROXY === 'true') {
    const xff = headers.get('x-forwarded-for')
    if (xff) {
      const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
      if (hops.length > 0) return hops[hops.length - 1] // right-most = proxy-attached
    }
    const real = headers.get('x-real-ip')
    if (real) return real.trim()
  }
  return 'untrusted'
}

/** Normalized per-account key for credential-stuffing/brute-force limiting. */
export function accountKey(email: unknown): string {
  return String(email ?? '').trim().toLowerCase() || 'unknown'
}

/**
 * Enforce a per-IP bucket ONLY when the IP is actually identifiable (i.e. not
 * the 'untrusted' sentinel returned when no trusted proxy fronts the app).
 * Without a reliable client IP we must NOT collapse everyone into one global
 * bucket; callers pair this with a non-spoofable per-account limit instead.
 */
export function rateLimitIp(ip: string, prefix: string, limit: number, windowSec: number): RateResult {
  if (ip === 'untrusted') return { allowed: true, retryAfterSec: 0 }
  return rateLimit(`${prefix}:ip:${ip}`, limit, windowSec)
}
