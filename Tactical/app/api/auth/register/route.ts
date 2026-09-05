import { NextResponse, type NextRequest } from 'next/server'
import { createUser } from '@/lib/auth/users'
import { createSession, assertServerSecret } from '@/lib/auth/session'
import { setAuthCookies } from '@/lib/auth/middleware'
import { rateLimitIp, rateLimit, clientIp, accountKey } from '@/lib/auth/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  assertServerSecret()
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  // Per-IP cap only when the IP is trustworthy (so an unidentifiable client is
  // not globally throttled), plus a per-email cap that always applies.
  const ipRl = rateLimitIp(clientIp(req.headers), 'register', 20, 3600)
  const acctRl = rateLimit(`register:acct:${accountKey(body?.email)}`, 3, 3600)
  if (!ipRl.allowed || !acctRl.allowed) {
    const retry = Math.max(ipRl.retryAfterSec, acctRl.retryAfterSec)
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retry) } })
  }
  const { user, error } = await createUser(body?.email, body?.password)
  if (error || !user) return NextResponse.json({ error: 'registration_failed', message: error }, { status: 400 })

  const { token, csrfSecret } = await createSession(user.id)
  const res = NextResponse.json({ user: { id: user.id, email: user.email }, csrfToken: csrfSecret })
  setAuthCookies(res, token, csrfSecret)
  return res
}
