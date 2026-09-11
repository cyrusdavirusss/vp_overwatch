/** User accounts (PG-backed). */
import { query } from '../db/pool.ts'
import { hashPassword, verifyPassword, isValidEmail, passwordPolicyError } from './crypto.ts'

export interface User { id: number; email: string }

export async function createUser(email: string, password: string): Promise<{ user?: User; error?: string }> {
  const normEmail = String(email ?? '').trim().toLowerCase()
  if (!isValidEmail(normEmail)) return { error: 'Enter a valid email address.' }
  const pwErr = passwordPolicyError(password)
  if (pwErr) return { error: pwErr }

  const { hash, salt } = hashPassword(password)
  try {
    const { rows } = await query<{ id: number; email: string }>(
      `INSERT INTO users (email, password_hash, password_salt) VALUES ($1,$2,$3) RETURNING id, email`,
      [normEmail, hash, salt],
    )
    // Seed default alert settings row.
    await query(`INSERT INTO user_alert_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [rows[0].id])
    return { user: { id: Number(rows[0].id), email: rows[0].email } }
  } catch (e: any) {
    if (e?.code === '23505') return { error: 'An account with that email already exists.' }
    throw e
  }
}

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const normEmail = String(email ?? '').trim().toLowerCase()
  const { rows } = await query<{ id: number; email: string; password_hash: string; password_salt: string }>(
    `SELECT id, email, password_hash, password_salt FROM users WHERE email=$1`,
    [normEmail],
  )
  if (rows.length === 0) {
    // Equalize timing against a dummy verification to reduce user enumeration.
    verifyPassword(password, '00', 'zz')
    return null
  }
  const row = rows[0]
  if (!verifyPassword(password, row.password_hash, row.password_salt)) return null
  return { id: Number(row.id), email: row.email }
}
