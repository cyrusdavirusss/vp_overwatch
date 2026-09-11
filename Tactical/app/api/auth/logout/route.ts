import { NextResponse, type NextRequest } from 'next/server'
import { destroySession, SESSION_COOKIE } from '@/lib/auth/session'
import { clearAuthCookies, currentSession, checkCsrf } from '@/lib/auth/middleware'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await currentSession(req)
  // A valid session may only be torn down with a matching CSRF token, so a
  // cross-site POST cannot force-log-out a victim. With no/invalid session the
  // request is a harmless no-op that just clears any stray cookies.
  if (session) {
    const csrf = checkCsrf(req, session)
    if (csrf) return csrf
    await destroySession(req.cookies.get(SESSION_COOKIE)?.value)
  }
  const res = NextResponse.json({ ok: true })
  clearAuthCookies(res)
  return res
}
