/**
 * Request-side auth helpers for Route Handlers. Verifies the session cookie
 * against the DB (signature/expiry/existence), enforces CSRF (double-submit)
 * on state-changing requests, and centralizes cookie set/clear.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getSession, SESSION_COOKIE, CSRF_COOKIE, SESSION_TTL_SECONDS, type SessionInfo } from './session.ts'
import { constantTimeEqual } from './crypto.ts'

const isProd = process.env.NODE_ENV === 'production'

export async function currentSession(req: NextRequest): Promise<SessionInfo | null> {
  return getSession(req.cookies.get(SESSION_COOKIE)?.value)
}

/** Returns the session or a 401 JSON response. */
export async function requireUser(req: NextRequest): Promise<SessionInfo | NextResponse> {
  const s = await currentSession(req)
  if (!s) {
    return NextResponse.json({ error: 'authentication_required', message: 'Sign in to continue.' }, { status: 401 })
  }
  return s
}

/** Double-submit CSRF: header x-csrf-token must equal the session's secret
 *  (also mirrored in the readable vp_csrf cookie). Required on unsafe methods. */
export function checkCsrf(req: NextRequest, session: SessionInfo): NextResponse | null {
  const header = req.headers.get('x-csrf-token') ?? ''
  const cookie = req.cookies.get(CSRF_COOKIE)?.value ?? ''
  if (!header || !constantTimeEqual(header, session.csrfSecret) || !constantTimeEqual(cookie, session.csrfSecret)) {
    return NextResponse.json({ error: 'csrf_failed', message: 'Invalid or missing CSRF token.' }, { status: 403 })
  }
  return null
}

export function setAuthCookies(res: NextResponse, token: string, csrfSecret: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS,
  })
  // Readable by JS so the SPA can echo it back in the x-csrf-token header.
  res.cookies.set(CSRF_COOKIE, csrfSecret, {
    httpOnly: false, secure: isProd, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 0 })
  res.cookies.set(CSRF_COOKIE, '', { httpOnly: false, secure: isProd, sameSite: 'lax', path: '/', maxAge: 0 })
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse
}
