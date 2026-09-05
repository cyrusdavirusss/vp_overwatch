import { NextResponse, type NextRequest } from 'next/server'
import { verifyLogin } from '@/lib/auth/users'
import { createSession, assertServerSecret } from '@/lib/auth/session'
import { setAuthCookies } from '@/lib/auth/middleware'
import { rateLimit, rateLimitIp, clientIp, accountKey } from '@/lib/auth/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  assertServerSecret()
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  // Limit by source IP (best-effort) AND by the targeted account (non-spoofable)
  // so header spoofing cannot lift the per-account brute-force ceiling.
  const ipRl = rateLimitIp(clientIp(req.headers), 'login', 30, 900)
  const acctRl = rateLimit(`login:acct:${accountKey(body?.email)}`, 8, 900)
  if (!ipRl.allowed || !acctRl.allowed) {
    const retry = Math.max(ipRl.retryAfterSec, acctRl.retryAfterSec)
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retry) } })
  }
  const user = await verifyLogin(body?.email, body?.password)
  if (!user) return NextResponse.json({ error: 'invalid_credentials', message: 'Incorrect email or password.' }, { status: 401 })

  const { token, csrfSecret } = await createSession(user.id)
  const res = NextResponse.json({ user: { id: user.id, email: user.email }, csrfToken: csrfSecret })
  setAuthCookies(res, token, csrfSecret)
  return res
}
