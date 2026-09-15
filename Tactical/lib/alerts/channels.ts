/**
 * Alert delivery for the three opt-in channels: browser notification, text
 * message, and automated phone call. A user may enable any combination.
 *
 * Every sender reports honestly, because a delivery ledger that lies is worse
 * than no ledger at all:
 *   'sent'     only when the provider ACCEPTED the message
 *   'failed'   provider rejected it, or the user asked for the channel but gave
 *              us nowhere to send (no browser subscription / no number on file)
 *   'disabled' the channel has no provider credentials configured at all
 *
 * Nothing here is ever recorded as 'sent' on the strength of an intention.
 * Credentials are env-only: VAPID_* for push, TWILIO_* for text + voice.
 *
 * Twilio is called over its REST API with fetch rather than the SDK: this module
 * is imported both by Next.js route handlers and by plain node scripts
 * (`node --experimental-strip-types`), and the SDK's dynamic require does not
 * resolve in the latter.
 */

export type DeliveryChannel = 'push' | 'sms' | 'call' | 'inapp'
export type DeliveryStatus = 'sent' | 'failed' | 'disabled'

const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts'
const SEND_TIMEOUT_MS = 15_000

// ── configuration probes ────────────────────────────────────────────────────

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
}

export function channelConfigured(channel: DeliveryChannel): boolean {
  if (channel === 'push') return pushConfigured()
  if (channel === 'sms' || channel === 'call') return twilioConfigured()
  return true // in-app is always available: it needs no provider
}

/** Human-readable reason a channel cannot deliver, for the settings screen. */
export function channelUnavailableReason(channel: DeliveryChannel): string | null {
  if (channel === 'push') return pushConfigured() ? null : 'Push keys are not configured on the server.'
  if (channel === 'sms' || channel === 'call') {
    return twilioConfigured() ? null : 'Text/voice provider (Twilio) is not configured on the server.'
  }
  return null
}

// ── browser push ────────────────────────────────────────────────────────────

export interface PushSubscriptionJson {
  endpoint: string
  keys?: { p256dh?: string; auth?: string }
}

/** A stored push_token is the browser's subscription, serialized as JSON. */
export function parsePushSubscription(raw: string | null | undefined): PushSubscriptionJson | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.endpoint === 'string' && parsed.endpoint.startsWith('https://')) return parsed
    return null
  } catch {
    return null
  }
}

export interface PushResult { status: DeliveryStatus; gone: boolean }

/**
 * Send a browser notification. `gone` means the push service told us the
 * subscription no longer exists (browser data cleared, permission revoked) —
 * the caller should forget the stored token rather than retry forever.
 */
export async function sendPush(sub: PushSubscriptionJson | null, title: string, body: string, data?: Record<string, unknown>): Promise<PushResult> {
  if (!pushConfigured()) return { status: 'disabled', gone: false }
  if (!sub) return { status: 'failed', gone: false }

  try {
    const webpush = (await import('web-push')).default
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    )
    await webpush.sendNotification(sub as any, JSON.stringify({ title, body, ...(data ?? {}) }), { timeout: SEND_TIMEOUT_MS })
    return { status: 'sent', gone: false }
  } catch (err: any) {
    const code = err?.statusCode
    if (code === 404 || code === 410) return { status: 'failed', gone: true }
    console.error('[channels] push failed:', err?.message || err)
    return { status: 'failed', gone: false }
  }
}

// ── text message (SMS) ──────────────────────────────────────────────────────

/**
 * Send a text. NOTE: this delivers to a real phone number and costs money per
 * message — callers must have verified the user actually asked for this.
 */
export async function sendSms(to: string | null, body: string): Promise<DeliveryStatus> {
  if (!twilioConfigured()) return 'disabled'
  if (!to) return 'failed'
  return twilioPost('Messages.json', { To: to, From: process.env.TWILIO_PHONE_NUMBER as string, Body: body })
}

// ── automated phone call ────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))
}

/**
 * Voice announcements repeat the line once ("King Air is airborne. King Air
 * is airborne."). A spoken call is easy to half-hear, so announcing twice is how
 * these are normally delivered — but push and text stay single, because a
 * doubled sentence reads like a bug on a screen.
 */
export function spokenMessage(message: string): string {
  const clean = message.trim()
  if (!clean) return clean
  return `${clean} ${clean}`
}

/** Place a call that reads the message aloud in an Australian voice. */
export async function sendCall(to: string | null, message: string): Promise<DeliveryStatus> {
  if (!twilioConfigured()) return 'disabled'
  if (!to) return 'failed'
  const twiml = `<Response><Say voice="alice" language="en-AU">${escapeXml(spokenMessage(message))}</Say></Response>`
  return twilioPost('Calls.json', { To: to, From: process.env.TWILIO_PHONE_NUMBER as string, Twiml: twiml })
}

async function twilioPost(path: string, form: Record<string, string>): Promise<DeliveryStatus> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string
  const token = process.env.TWILIO_AUTH_TOKEN as string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(`${TWILIO_API}/${sid}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    })
    if (res.ok) return 'sent'
    const detail = await res.text().catch(() => '')
    console.error(`[channels] twilio ${path} rejected (${res.status}): ${detail.slice(0, 300)}`)
    return 'failed'
  } catch (err: any) {
    console.error(`[channels] twilio ${path} error:`, err?.message || err)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}
