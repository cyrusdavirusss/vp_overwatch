/**
 * Signed tokens for alert links that arrive by email or SMS.
 *
 * These links have to work without a login — the whole point is that someone
 * annoyed by an alert can stop it in one tap from their inbox, not sign in and
 * hunt through settings. So the link carries its own proof: a small payload
 * (user id + purpose + expiry) with an HMAC over it, keyed from AUTH_SECRET.
 *
 * Properties that matter:
 *  - STATELESS. No table, no cleanup job, nothing to leak.
 *  - EXPIRING. A link in an old inbox is not a permanent key to someone's account.
 *  - PURPOSE-SCOPED. A token minted to unsubscribe cannot be replayed against any
 *    other action, because the purpose string is inside the signature.
 *  - FAIL CLOSED. No AUTH_SECRET means no tokens verify, rather than all of them.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type TokenPurpose = 'unsubscribe' | 'verify-sms' | 'verify-email'

const DEFAULT_TTL_MS = 30 * 24 * 3600 * 1000 // 30 days: long enough for a dormant inbox

function secret(): string | null {
  const s = process.env.AUTH_SECRET
  return s && s.length >= 16 ? s : null
}

function sign(payload: string): string | null {
  const key = secret()
  if (!key) return null
  return createHmac('sha256', key).update(payload).digest('base64url')
}

export interface TokenPayload { userId: number; purpose: TokenPurpose; expiresAt: number }

/** Mint a token. Returns null when the deployment has no signing secret. */
export function mintToken(userId: number, purpose: TokenPurpose, ttlMs: number = DEFAULT_TTL_MS, nowMs: number = Date.now()): string | null {
  const expiresAt = nowMs + ttlMs
  const payload = `${userId}.${purpose}.${expiresAt}`
  const sig = sign(payload)
  if (!sig) return null
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

export type TokenCheck =
  | { ok: true; userId: number; purpose: TokenPurpose }
  | { ok: false; reason: string }

export function verifyToken(token: string | null | undefined, purpose: TokenPurpose, nowMs: number = Date.now()): TokenCheck {
  if (!token) return { ok: false, reason: 'no token supplied' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }

  let payload: string
  try {
    payload = Buffer.from(parts[0], 'base64url').toString('utf8')
  } catch {
    return { ok: false, reason: 'undecodable payload' }
  }

  const expected = sign(payload)
  if (!expected) return { ok: false, reason: 'no signing secret configured (fail closed)' }

  const got = Buffer.from(parts[1])
  const want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad signature' }

  const [rawId, rawPurpose, rawExpiry] = payload.split('.')
  if (rawPurpose !== purpose) return { ok: false, reason: `token is for ${rawPurpose}, not ${purpose}` }
  const expiresAt = Number(rawExpiry)
  if (!Number.isFinite(expiresAt) || nowMs > expiresAt) return { ok: false, reason: 'token expired' }

  return { ok: true, userId: Number(rawId), purpose }
}

/** Absolute unsubscribe URL for an alert, or null when the deployment cannot build one. */
export function unsubscribeUrl(userId: number, nowMs: number = Date.now()): string | null {
  const baseUrl = (process.env.ALERT_PUBLIC_URL || '').replace(/\/+$/, '')
  if (!baseUrl) return null
  const token = mintToken(userId, 'unsubscribe', DEFAULT_TTL_MS, nowMs)
  if (!token) return null
  return `${baseUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`
}
