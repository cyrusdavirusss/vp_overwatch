/** GET/POST /api/alerts/settings — the caller's opt-in alert settings. */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse, checkCsrf } from '@/lib/auth/middleware'
import { getAlertSettings, updateAlertSettings } from '@/lib/alerts/store'

export const dynamic = 'force-dynamic'

// Smallest radius a user may arm. 25 m, not 1000 m: a phone's own GPS fix is
// only accurate to roughly 5-30 m outdoors (worse in a city), so any radius
// below that is finer than the fix's own error and would be an honest-looking
// lie. Hysteresis still requires exit >= enter.
const MIN_ENTER_METRES = 25
const MAX_EXIT_METRES = 300_000

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const s = await getAlertSettings(auth.userId)
  return NextResponse.json({
    pushEnabled: s.pushEnabled, smsEnabled: s.smsEnabled, smsConsent: s.smsConsent,
    preciseLocation: s.preciseLocation,
    enterMetres: s.enterMetres, exitMetres: s.exitMetres, hasPushToken: !!s.pushToken,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const csrf = checkCsrf(req, auth)
  if (csrf) return csrf
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  // Optional per-user proximity radii. Bounds come from the constants above;
  // exit >= enter is required because hysteresis needs the exit ring outside
  // the enter ring, else reject rather than store junk.
  let enterMetres: number | undefined
  let exitMetres: number | undefined
  if (body?.enterMetres !== undefined || body?.exitMetres !== undefined) {
    const en = Number(body?.enterMetres); const ex = Number(body?.exitMetres)
    if (!Number.isFinite(en) || !Number.isFinite(ex) || en < MIN_ENTER_METRES || ex > MAX_EXIT_METRES || ex < en) {
      return NextResponse.json({ error: 'invalid_radii', message: `Require ${MIN_ENTER_METRES} <= enter <= exit <= ${MAX_EXIT_METRES} metres.` }, { status: 400 })
    }
    enterMetres = Math.round(en); exitMetres = Math.round(ex)
  }
  await updateAlertSettings(auth.userId, {
    pushEnabled: typeof body?.pushEnabled === 'boolean' ? body.pushEnabled : undefined,
    smsEnabled: typeof body?.smsEnabled === 'boolean' ? body.smsEnabled : undefined,
    smsConsent: typeof body?.smsConsent === 'boolean' ? body.smsConsent : undefined,
    pushToken: typeof body?.pushToken === 'string' ? body.pushToken : undefined,
    preciseLocation: typeof body?.preciseLocation === 'boolean' ? body.preciseLocation : undefined,
    enterMetres, exitMetres,
  })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
