/** GET/POST /api/alerts/settings — the caller's opt-in alert settings. */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse, checkCsrf } from '@/lib/auth/middleware'
import { getAlertSettings, updateAlertSettings } from '@/lib/alerts/store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const s = await getAlertSettings(auth.userId)
  return NextResponse.json({
    pushEnabled: s.pushEnabled, smsEnabled: s.smsEnabled, smsConsent: s.smsConsent,
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
  // Optional per-user proximity radii. Validate: 1km..300km and exit >= enter
  // (hysteresis requires exit outside enter), else reject rather than store junk.
  let enterMetres: number | undefined
  let exitMetres: number | undefined
  if (body?.enterMetres !== undefined || body?.exitMetres !== undefined) {
    const en = Number(body?.enterMetres); const ex = Number(body?.exitMetres)
    if (!Number.isFinite(en) || !Number.isFinite(ex) || en < 1000 || ex > 300000 || ex < en) {
      return NextResponse.json({ error: 'invalid_radii', message: 'Require 1000 <= enter <= exit <= 300000 metres.' }, { status: 400 })
    }
    enterMetres = Math.round(en); exitMetres = Math.round(ex)
  }
  await updateAlertSettings(auth.userId, {
    pushEnabled: typeof body?.pushEnabled === 'boolean' ? body.pushEnabled : undefined,
    smsEnabled: typeof body?.smsEnabled === 'boolean' ? body.smsEnabled : undefined,
    smsConsent: typeof body?.smsConsent === 'boolean' ? body.smsConsent : undefined,
    pushToken: typeof body?.pushToken === 'string' ? body.pushToken : undefined,
    enterMetres, exitMetres,
  })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
