/**
 * Alert delivery for the four opt-in channels: browser notification, email,
 * text message, and automated phone call. A user may enable any combination.
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
 * Twilio and SendGrid are called over their REST APIs with fetch rather than
 * through an SDK: this module is imported both by Next.js route handlers and by
 * plain node scripts (`node --experimental-strip-types`), and a package's dynamic
 * require does not resolve in the latter.
 */

export type DeliveryChannel = 'push' | 'email' | 'sms' | 'call' | 'inapp'
export type DeliveryStatus = 'sent' | 'failed' | 'disabled' | 'held'
// 'held' means the server deliberately did NOT send this one, and the row says
// so. Quiet hours are the only thing that produce it today. Without it, a held
// alert is indistinguishable from one that was never asked for, and the first
// support question ("why didn't I get the call?") becomes unanswerable.

const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts'
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'
const SEND_TIMEOUT_MS = 15_000

// ── configuration probes ────────────────────────────────────────────────────
//
// The provider is a deployment choice, not a code path. ALERT_PROVIDER selects it
// and defaults to Twilio so an existing deployment keeps working untouched. Every
// sender below dispatches on it, which is what makes swapping vendors a config
// change rather than a rewrite.

import {
  sinchSmsConfigured, sinchVoiceConfigured, mailgunConfigured,
  sinchSendSms, sinchSendCall, mailgunSendEmail,
} from './providers/sinch.ts'

export type AlertProvider = 'twilio' | 'sinch'

export function alertProvider(): AlertProvider {
  return process.env.ALERT_PROVIDER === 'sinch' ? 'sinch' : 'twilio'
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

/** Can the server deliver a text right now, with whichever provider is selected? */
export function smsConfigured(): boolean {
  return alertProvider() === 'sinch' ? sinchSmsConfigured() : twilioConfigured()
}

/** Can the server place a call right now? Voice is a separate Sinch capability
 *  from SMS and carries its own credentials, so it is probed separately. */
export function callConfigured(): boolean {
  return alertProvider() === 'sinch' ? sinchVoiceConfigured() : twilioConfigured()
}

export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
}

/**
 * Email needs a SENDER as well as a key. Without a verified From address on a
 * domain the provider is willing to sign for, the send is rejected — so a missing
 * From is treated as "not configured" rather than attempted and failed.
 *
 * It also requires ALERT_PUBLIC_URL, which is what the unsubscribe link is built
 * from. An alert email with no way out is spam regardless of how useful the alert
 * is, so a deployment that cannot produce that link must not be able to send at
 * all. Fail closed.
 */
export function emailConfigured(): boolean {
  // ALERT_PUBLIC_URL is required either way: it is what the unsubscribe link is
  // built from, and an alert email that cannot be unsubscribed from must not send.
  if (!process.env.ALERT_PUBLIC_URL) return false
  return alertProvider() === 'sinch' ? mailgunConfigured() : Boolean(process.env.SENDGRID_API_KEY && process.env.ALERT_EMAIL_FROM)
}

export function channelConfigured(channel: DeliveryChannel): boolean {
  if (channel === 'push') return pushConfigured()
  if (channel === 'email') return emailConfigured()
  if (channel === 'sms') return smsConfigured()
  if (channel === 'call') return callConfigured()
  return true // in-app is always available: it needs no provider
}

/** Human-readable reason a channel cannot deliver, for the settings screen. */
export function channelUnavailableReason(channel: DeliveryChannel): string | null {
  if (channel === 'push') return pushConfigured() ? null : 'Push keys are not configured on the server.'
  if (channel === 'email') return emailConfigured() ? null : 'Email provider (SendGrid) is not configured on the server.'
  if (channel === 'sms') {
    return smsConfigured() ? null : `Text provider (${alertProvider()}) is not configured on the server.`
  }
  if (channel === 'call') {
    return callConfigured() ? null : `Voice provider (${alertProvider()}) is not configured on the server.`
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
  if (alertProvider() === 'sinch') return (await sinchSendSms(to, body)) as DeliveryStatus
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
  // The doubled read is applied before the handoff, so both providers speak the
  // same sentence twice rather than one of them quietly not doing it.
  const spoken = spokenMessage(message)
  if (alertProvider() === 'sinch') return (await sinchSendCall(to, spoken)) as DeliveryStatus
  if (!twilioConfigured()) return 'disabled'
  if (!to) return 'failed'
  const twiml = `<Response><Say voice="alice" language="en-AU">${escapeXml(spoken)}</Say></Response>`
  return twilioPost('Calls.json', { To: to, From: process.env.TWILIO_PHONE_NUMBER as string, Twiml: twiml })
}

// ── email ───────────────────────────────────────────────────────────────────

/** Escape for the HTML part. The text part is sent verbatim. */
function escapeHtml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c] as string))
}

export interface EmailResult {
  status: DeliveryStatus
  /** Provider said this address is dead (bounce/complaint) — stop retrying it. */
  gone: boolean
}

/**
 * Send an alert email.
 *
 * Every message carries a working one-click unsubscribe, because an alert email
 * without a way out is spam no matter how useful the alert is. We ask the
 * provider to honour that too (List-Unsubscribe), so a provider-side click is
 * reported back to us as an unsubscribe rather than silently unsubscribing the
 * person from everything at that provider.
 */
export async function sendEmail(to: string | null, subject: string, body: string, opts: { unsubscribeUrl?: string } = {}): Promise<EmailResult> {
  if (!emailConfigured()) return { status: 'disabled', gone: false }
  if (!to || !/.+@.+\..+/.test(to)) return { status: 'failed', gone: false }

  if (alertProvider() === 'sinch') return await mailgunSendEmail(to, subject, body, opts)

  const from = process.env.ALERT_EMAIL_FROM as string
  const fromName = process.env.ALERT_EMAIL_FROM_NAME || 'VP-Overwatch'
  const text = opts.unsubscribeUrl ? `${body}\n\nUnsubscribe: ${opts.unsubscribeUrl}` : body
  const html = `<div style="font:15px/1.5 -apple-system,system-ui,sans-serif;color:#111">`
    + `<p>${escapeHtml(body)}</p>`
    + (opts.unsubscribeUrl
        ? `<p style="font-size:12px;color:#666"><a href="${escapeHtml(opts.unsubscribeUrl)}">Unsubscribe from these alerts</a></p>`
        : '')
    + `</div>`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
        ...(opts.unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${opts.unsubscribeUrl}>` } } : {}),
      }),
      signal: controller.signal,
    })
    // SendGrid answers 202 with an empty body on acceptance.
    if (res.ok) return { status: 'sent', gone: false }
    const detail = await res.text().catch(() => '')
    console.error(`[channels] sendgrid rejected (${res.status}): ${detail.slice(0, 300)}`)
    return { status: 'failed', gone: res.status === 400 }
  } catch (err: any) {
    console.error('[channels] sendgrid error:', err?.message || err)
    return { status: 'failed', gone: false }
  } finally {
    clearTimeout(timer)
  }
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
