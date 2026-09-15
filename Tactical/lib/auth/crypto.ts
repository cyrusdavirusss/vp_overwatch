/**
 * Auth primitives built on Node's built-in `crypto` (no native deps).
 *  • Passwords: scrypt with a per-user random salt + a server-side pepper
 *    (AUTH_SECRET). Verification is constant-time.
 *  • Session tokens: 256-bit random; only the SHA-256 hash is stored in the DB,
 *    so a database leak does not yield usable session tokens.
 *  • CSRF: per-session random secret (double-submit), compared constant-time.
 * Pure/deterministic given inputs (except the RNG helpers) → unit-testable.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto'

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

// ── Reversible field encryption ────────────────────────────────────────────
// Text/voice alerts need the phone number BACK to dial it, so hashing (above)
// cannot be used — it is one-way by design. AES-256-GCM with a key derived
// deterministically from AUTH_SECRET: the same secret decrypts across restarts,
// and a database leak alone yields nothing readable.
//
// Format: v1.<iv>.<tag>.<ciphertext>  (base64url), so the version can change
// later without guessing how an old value was written.
const FIELD_KEY_SALT = 'vp-overwatch:field-encryption:v1'
let cachedFieldKey: Buffer | null = null

function fieldKey(): Buffer {
  // scrypt is deliberately slow (~100 ms) — cache it, or every dial-out pays it.
  if (!cachedFieldKey) {
    cachedFieldKey = scryptSync('field-encryption' + pepper(), FIELD_KEY_SALT, 32, SCRYPT_PARAMS)
  }
  return cachedFieldKey
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', fieldKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`
}

export function decryptField(ref: string | null | undefined): string | null {
  if (!ref) return null
  try {
    const [version, ivB64, tagB64, ctB64] = String(ref).split('.')
    if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) return null
    const decipher = createDecipheriv('aes-256-gcm', fieldKey(), Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null // wrong key, tampered, or not ours
  }
}

/**
 * Normalize a phone number to E.164 (e.g. 0412 345 678 -> +61412345678) or null.
 * Australian default country code (+61) because that is where this deploys.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const digits = input.replace(/[^\d+]/g, '')
  if (!digits) return null
  if (digits.startsWith('+')) return /^\+\d{8,15}$/.test(digits) ? digits : null
  if (digits.startsWith('0') && digits.length === 10) return `+61${digits.slice(1)}`
  if (digits.startsWith('61') && digits.length === 11) return `+${digits}`
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
}

/** Last 3 digits only, for showing the user which number they saved. */
export function maskPhone(e164: string | null): string | null {
  if (!e164) return null
  return `${'•'.repeat(Math.max(0, e164.length - 3))}${e164.slice(-3)}`
}
