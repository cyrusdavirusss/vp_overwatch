/**
 * GET/POST /api/alerts/settings — the caller's opt-in alert settings.
 *
 * A user may opt into ANY combination of the four delivery channels:
 *   push  browser notification (subscription arrives from the browser itself)
 *   email to the account address (needs consent)
 *   sms   text message  (needs a number + recorded consent)
 *   call  automated voice call (needs a number + recorded consent)
 * plus 'inapp' which is always on (a row they read in the dashboard).
 *
 * CONSENT IS AUDITED, NOT JUST CHECKED. Flipping a consent flag here also writes
 * the when/how trail (recordConsent/revokeConsent), because a boolean answers
 * "may we" while only the trail answers "prove it" — and Australian outbound voice
 * and SMS are regulated. Withdrawing consent also turns the channel off, so the
 * intent lands instead of being rejected by the consent gate below.
 *
 * Numbers are accepted in, stored ENCRYPTED, and never returned — the client is
 * only ever told whether one is on file (hasSmsNumber / hasCallNumber).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse, checkCsrf } from '@/lib/auth/middleware'
import {
  getAlertSettings, updateAlertSettings, setAlertPhone, setPushSubscription, hasAlertPhones,
  getAlertEmail, recordConsent, revokeConsent,
} from '@/lib/alerts/store'
import { normalizePhone } from '@/lib/auth/crypto'
import { pushConfigured, emailConfigured, smsConfigured, callConfigured } from '@/lib/alerts/channels'

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
  const numbers = await hasAlertPhones(auth.userId)
  const email = await getAlertEmail(auth.userId)
  return NextResponse.json({
    pushEnabled: s.pushEnabled, hasPushSubscription: !!s.pushToken,
    emailEnabled: s.emailEnabled, emailConsent: s.emailConsent,
    // Masked: enough for the settings screen to say where alerts would go, not
    // enough for this response to be worth stealing.
    emailMasked: email ? email.replace(/^(.{1,2}).*(@.*)$/, '$1***$2') : null,
    smsEnabled: s.smsEnabled, smsConsent: s.smsConsent, hasSmsNumber: numbers.sms,
    callEnabled: s.callEnabled, callConsent: s.callConsent, hasCallNumber: numbers.call,
    preciseLocation: s.preciseLocation,
    enterMetres: s.enterMetres, exitMetres: s.exitMetres,
    quietHours: {
      startHour: s.quietHoursStart, endHour: s.quietHoursEnd,
      timezone: s.quietHoursTz, urgentBypass: s.urgentBypass,
    },
    // Whether the SERVER can deliver a channel at all. Lets the settings screen
    // show "not available yet" instead of letting someone opt into a dead
    // channel and then silently receive nothing.
    channelsAvailable: {
      push: pushConfigured(),
      email: emailConfigured(),
      sms: smsConfigured(),
      call: callConfigured(),
      inapp: true,
    },
    // The VAPID public key is public by definition (it is sent to the browser's push
    // service as part of every subscription) and the client cannot subscribe without
    // it, so shipping it here beats duplicating it into a second NEXT_PUBLIC_ var where
    // the two copies could drift apart.
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const csrf = checkCsrf(req, auth)
  if (csrf) return csrf
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const key of ['pushEnabled', 'emailEnabled', 'emailConsent', 'smsEnabled', 'smsConsent', 'callEnabled', 'callConsent', 'preciseLocation'] as const) {
    if (typeof body?.[key] === 'boolean') patch[key] = body[key]
  }

  // Withdrawing consent turns the channel off in the same request. Without this
  // the consent gate below would reject the withdrawal and leave the person
  // opted in, which is the one outcome they were trying to avoid.
  if (patch.emailConsent === false) patch.emailEnabled = false
  if (patch.smsConsent === false) patch.smsEnabled = false
  if (patch.callConsent === false) patch.callEnabled = false

  // Quiet hours: two local hours in a named zone, or both null to switch off.
  if (body?.quietHours !== undefined) {
    const q = body.quietHours
    if (q === null) {
      patch.quietHoursStart = null; patch.quietHoursEnd = null
    } else {
      const start = q?.startHour; const end = q?.endHour
      const hourOk = (h: unknown) => h === null || (Number.isInteger(h) && Number(h) >= 0 && Number(h) <= 23)
      if (!hourOk(start) || !hourOk(end) || (start === null) !== (end === null)) {
        return NextResponse.json({ error: 'invalid_quiet_hours', message: 'Quiet hours need both hours set (0-23), or both cleared.' }, { status: 400 })
      }
      if (q?.timezone !== undefined) {
        try {
          new Intl.DateTimeFormat('en-AU', { timeZone: String(q.timezone) })
        } catch {
          return NextResponse.json({ error: 'invalid_timezone', field: 'quietHours', message: `${q.timezone} is not a known timezone.` }, { status: 400 })
        }
        patch.quietHoursTz = String(q.timezone)
      }
      if (typeof q?.urgentBypass === 'boolean') patch.urgentBypass = q.urgentBypass
      patch.quietHoursStart = start === null ? null : Number(start)
      patch.quietHoursEnd = end === null ? null : Number(end)
    }
  }

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

  // Phone numbers: validated BEFORE anything is written, so a bad number cannot
  // half-apply a settings change.
  const touchesSmsNumber = body?.smsPhone !== undefined
  const touchesCallNumber = body?.callPhone !== undefined
  let smsPhone: string | null = null
  let callPhone: string | null = null
  if (touchesSmsNumber && body.smsPhone !== null && body.smsPhone !== '') {
    smsPhone = normalizePhone(body.smsPhone)
    if (!smsPhone) return NextResponse.json({ error: 'invalid_phone', field: 'smsPhone', message: 'Use a mobile number, e.g. 0412 345 678.' }, { status: 400 })
  }
  if (touchesCallNumber && body.callPhone !== null && body.callPhone !== '') {
    callPhone = normalizePhone(body.callPhone)
    if (!callPhone) return NextResponse.json({ error: 'invalid_phone', field: 'callPhone', message: 'Use a mobile number, e.g. 0412 345 678.' }, { status: 400 })
  }

  // Consent gate: a channel cannot be switched on without recorded consent for
  // it. Enforced on the EFFECTIVE value so both orderings are covered (enabling
  // and consenting in one request, or enabling without ever consenting).
  const current = await getAlertSettings(auth.userId)
  const effective = { ...current, ...patch } as typeof current
  if (effective.emailEnabled && !effective.emailConsent) {
    return NextResponse.json({ error: 'consent_required', channel: 'email', message: 'Email alerts need your consent.' }, { status: 400 })
  }
  if (effective.smsEnabled && !effective.smsConsent) {
    return NextResponse.json({ error: 'consent_required', channel: 'sms', message: 'Text alerts need your consent.' }, { status: 400 })
  }
  if (effective.callEnabled && !effective.callConsent) {
    return NextResponse.json({ error: 'consent_required', channel: 'call', message: 'Phone-call alerts need your consent.' }, { status: 400 })
  }
  // Asking for a channel with nowhere to send it would just record failures.
  const numbers = await hasAlertPhones(auth.userId)
  const willHaveSms = touchesSmsNumber ? !!smsPhone : numbers.sms
  const willHaveCall = touchesCallNumber ? !!callPhone : numbers.call
  if (effective.smsEnabled && !willHaveSms) {
    return NextResponse.json({ error: 'number_required', channel: 'sms', message: 'Add a mobile number for text alerts.' }, { status: 400 })
  }
  if (effective.callEnabled && !willHaveCall) {
    return NextResponse.json({ error: 'number_required', channel: 'call', message: 'Add a mobile number for phone alerts.' }, { status: 400 })
  }

  await updateAlertSettings(auth.userId, { ...patch, enterMetres, exitMetres } as any)
  // The browser's PushManager subscription: object = subscribe, null = forget.
  if (body?.pushSubscription !== undefined) await setPushSubscription(auth.userId, body.pushSubscription)
  if (touchesSmsNumber) await setAlertPhone(auth.userId, 'sms', smsPhone)
  if (touchesCallNumber) await setAlertPhone(auth.userId, 'call', callPhone)

  // The audit trail. Written after the settings land, and only when the flag was
  // actually part of this request, so a GET-equivalent POST does not restamp the
  // consent time and quietly destroy the evidence of when it was really given.
  const CONSENT_CHANNELS = [
    ['email', 'emailConsent'],
    ['sms', 'smsConsent'],
    ['call', 'callConsent'],
  ] as const
  for (const [channel, key] of CONSENT_CHANNELS) {
    const sent = body?.[key]
    if (sent === true) await recordConsent(auth.userId, channel, 'settings-form', null)
    else if (sent === false) await revokeConsent(auth.userId, channel, 'settings-form-withdrawn')
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
