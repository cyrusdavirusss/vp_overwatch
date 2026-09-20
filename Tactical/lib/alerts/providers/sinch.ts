/**
 * Sinch provider: SMS, voice and email from one vendor.
 *
 * Chosen over Twilio for the same coverage at a materially lower Australian SMS
 * rate, and because Sinch is on the ACMA approved list for sender-ID registration.
 * Email comes via Mailgun, which is Sinch's email arm.
 *
 * Every endpoint, auth scheme and success code below is taken from Sinch's own
 * documentation, and the two things documentation cannot tell us are called out
 * where they appear:
 *
 *   - The SMS server URL is REGION-SPECIFIC ("Be sure to use the correct region in
 *     the server URL"), so it is configuration, not a constant.
 *   - The voice call carries a `voiceName`, and which voices a project offers is a
 *     dashboard fact, so it is configuration too.
 *   - Success codes differ per product: the voice API answers 201 with a sessionId,
 *     the SMS batches API 201. Neither answers 200, and treating 200 as success
 *     would report every real send as a failure.
 *
 * NOTHING HERE IS LIVE-TESTED YET. It cannot be: there are no credentials. The
 * shapes are from the docs and the first real send should be watched, not assumed.
 */

const TIMEOUT_MS = 15_000

export type ProviderStatus = 'sent' | 'failed' | 'disabled'

function basicAuth(id: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

export function sinchSmsConfigured(): boolean {
  return Boolean(process.env.SINCH_SERVICE_PLAN_ID && process.env.SINCH_API_TOKEN && process.env.SINCH_SMS_BASE_URL)
}

export function sinchVoiceConfigured(): boolean {
  return Boolean(process.env.SINCH_PROJECT_ID && process.env.SINCH_KEY_ID && process.env.SINCH_KEY_SECRET && process.env.SINCH_NUMBER)
}

export function mailgunConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.ALERT_EMAIL_FROM)
}

/**
 * Send one SMS.
 *
 * POST {region}.sms.api.sinch.com/xms/v1/{servicePlanId}/batches
 * Bearer auth. `to` is an ARRAY in this API — a bare string is rejected.
 */
export async function sinchSendSms(to: string | null, body: string): Promise<ProviderStatus> {
  if (!sinchSmsConfigured()) return 'disabled'
  if (!to) return 'failed'

  const base = (process.env.SINCH_SMS_BASE_URL as string).replace(/\/+$/, '')
  const planId = process.env.SINCH_SERVICE_PLAN_ID as string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/xms/v1/${planId}/batches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SINCH_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      // `from` is the registered alphanumeric sender ID, which is why the ACMA
      // registration is a prerequisite rather than a nicety.
      body: JSON.stringify({
        from: process.env.SINCH_SMS_FROM || 'VPOVERWATCH',
        to: [to],
        body,
      }),
      signal: controller.signal,
    })
    if (res.status === 201) return 'sent'
    const detail = await res.text().catch(() => '')
    console.error(`[channels] sinch sms rejected (${res.status}): ${detail.slice(0, 300)}`)
    return 'failed'
  } catch (err: any) {
    console.error('[channels] sinch sms error:', err?.message || err)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Place one automated call that reads the message aloud.
 *
 * POST {region}.voice.api.sinch.com/v2/projects/{projectId}/calls, HTTP Basic
 * KEY_ID:KEY_SECRET, SVAML in the body. 201 + a sessionId means the call was
 * created — not that it was answered, which is a distinction the delivery ledger
 * should not blur later.
 *
 * au1 is the Australian regional host. Sending AU-to-AU through a foreign region
 * is the kind of thing carriers quietly drop.
 */
export async function sinchSendCall(to: string | null, message: string): Promise<ProviderStatus> {
  if (!sinchVoiceConfigured()) return 'disabled'
  if (!to) return 'failed'

  const region = process.env.SINCH_VOICE_REGION || 'au1'
  const projectId = process.env.SINCH_PROJECT_ID as string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://${region}.voice.api.sinch.com/v2/projects/${projectId}/calls`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(process.env.SINCH_KEY_ID as string, process.env.SINCH_KEY_SECRET as string),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { type: 'PHONE', phone: { number: process.env.SINCH_NUMBER } },
        to: { type: 'PHONE', phone: { number: to } },
        events: {
          onAnswer: [
            {
              command: 'say',
              say: {
                text: message,
                // Which voices a project offers is a dashboard fact, so the name is
                // configuration. Defaulted to the AU English female voice Sinch
                // documents for Australian projects.
                voiceName: process.env.SINCH_VOICE_NAME || 'en-AU-Female',
                locale: 'en-AU',
              },
            },
          ],
          // Hang up when the message has been read, rather than leaving a recorded
          // voice waiting on the line.
          onFinish: { events: [{ command: 'hangup' }] },
        },
      }),
      signal: controller.signal,
    })
    if (res.status === 201) return 'sent'
    const detail = await res.text().catch(() => '')
    console.error(`[channels] sinch voice rejected (${res.status}): ${detail.slice(0, 300)}`)
    return 'failed'
  } catch (err: any) {
    console.error('[channels] sinch voice error:', err?.message || err)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send one alert email through Mailgun.
 *
 * POST {base}/v3/{domain}/messages, HTTP Basic api:KEY, form-encoded body
 * (Mailgun builds the MIME). EU-region accounts need api.eu.mailgun.net, so the
 * base is configuration.
 *
 * `h:List-Unsubscribe` is set to the same URL that appears in the body: one-click
 * unsubscribes in mail clients go through the header, and an address that cannot
 * be unsubscribed from the client's own button is the sort of thing that gets a
 * domain reported.
 */
export async function mailgunSendEmail(
  to: string | null,
  subject: string,
  body: string,
  opts: { unsubscribeUrl?: string } = {},
): Promise<{ status: ProviderStatus; gone: boolean }> {
  if (!mailgunConfigured()) return { status: 'disabled', gone: false }
  if (!to || !/.+@.+\..+/.test(to)) return { status: 'failed', gone: false }

  const base = (process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net').replace(/\/+$/, '')
  const domain = process.env.MAILGUN_DOMAIN as string
  const from = process.env.ALERT_EMAIL_FROM as string
  const fromName = process.env.ALERT_EMAIL_FROM_NAME || 'VP-Overwatch'

  const form = new URLSearchParams()
  form.set('from', `${fromName} <${from}>`)
  form.set('to', to)
  form.set('subject', subject)
  form.set('text', opts.unsubscribeUrl ? `${body}\n\nUnsubscribe: ${opts.unsubscribeUrl}` : body)
  if (opts.unsubscribeUrl) form.set('h:List-Unsubscribe', `<${opts.unsubscribeUrl}>`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth('api', process.env.MAILGUN_API_KEY as string),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: controller.signal,
    })
    // Mailgun answers 200 with an id and message on acceptance.
    if (res.ok) return { status: 'sent', gone: false }
    const detail = await res.text().catch(() => '')
    console.error(`[channels] mailgun rejected (${res.status}): ${detail.slice(0, 300)}`)
    // A permanent 4xx means the address itself is the problem; stop retrying it.
    return { status: 'failed', gone: res.status >= 400 && res.status < 500 }
  } catch (err: any) {
    console.error('[channels] mailgun error:', err?.message || err)
    return { status: 'failed', gone: false }
  } finally {
    clearTimeout(timer)
  }
}
