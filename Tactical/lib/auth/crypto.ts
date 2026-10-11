/**
 * Auth primitives built on Node's built-in `crypto` (no native deps).
 *  • Passwords: scrypt with a per-user random salt + a server-side pepper
 *    (AUTH_SECRET). Verification is constant-time.
 *  • Session tokens: 256-bit random; only the SHA-256 hash is stored in the DB,
 *    so a database leak does not yield usable session tokens.
 *  • CSRF: per-session random secret (double-submit), compared constant-time.
 * Pure/deterministic given inputs (except the RNG helpers) → unit-testable.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const SCRYPT_KEYLEN = 64
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }

function pepper(): string {
  // AUTH_SECRET is a server-only secret. Absent in unit tests → empty pepper is
  // acceptable there; production start-up asserts it is set (see session.ts).
  return process.env.AUTH_SECRET ?? ''
}

export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}

export function hashPassword(password: string, salt = randomHex(16)): { hash: string; salt: string } {
  const derived = scryptSync(password + pepper(), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
  return { hash: derived.toString('hex'), salt }
}

export function verifyPassword(password: string, hashHex: string, salt: string): boolean {
  let derived: Buffer
  try {
    derived = scryptSync(password + pepper(), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)
  } catch {
    return false
  }
  const stored = Buffer.from(hashHex, 'hex')
  if (stored.length !== derived.length) return false
  return timingSafeEqual(stored, derived)
}

/** A new opaque session token (given to the client) and its stored hash. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomHex(32)
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Basic RFC-5322-ish email sanity + length bound. */
export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** Minimum password policy. */
export function passwordPolicyError(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.'
  if (pw.length > 200) return 'Password is too long.'
  return null
}
