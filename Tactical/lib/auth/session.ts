/** Session lifecycle (PG-backed). Cookie holds the raw token; DB stores only
 *  its SHA-256 hash. CSRF secret is per-session (double-submit). */
import { query } from '../db/pool.ts'
import { newSessionToken, hashToken, randomHex } from './crypto.ts'

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30) // 30d

export interface SessionInfo { userId: number; email: string; csrfSecret: string }

export function assertServerSecret(): void {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required (server-only)')
}

export async function createSession(userId: number): Promise<{ token: string; csrfSecret: string; expiresAt: Date }> {
  const { token, tokenHash } = newSessionToken()
  const csrfSecret = randomHex(24)
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await query(
    `INSERT INTO sessions (token_hash, user_id, csrf_secret, expires_at) VALUES ($1,$2,$3,$4)`,
    [tokenHash, userId, csrfSecret, expiresAt.toISOString()],
  )
  return { token, csrfSecret, expiresAt }
}

export async function getSession(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token) return null
  const { rows } = await query<{ user_id: number; email: string; csrf_secret: string }>(
    `SELECT s.user_id, s.csrf_secret, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > NOW()`,
    [hashToken(token)],
  )
  if (rows.length === 0) return null
  return { userId: Number(rows[0].user_id), email: rows[0].email, csrfSecret: rows[0].csrf_secret }
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return
  await query(`DELETE FROM sessions WHERE token_hash=$1`, [hashToken(token)])
}

export async function purgeExpiredSessions(): Promise<void> {
  await query(`DELETE FROM sessions WHERE expires_at <= NOW()`)
}

export const SESSION_COOKIE = 'vp_session'
export const CSRF_COOKIE = 'vp_csrf'
export { SESSION_TTL_SECONDS }
