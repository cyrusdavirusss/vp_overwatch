/**
 * Inbound SMS webhook — the opt-out that keeps this service legal.
 *
 * An alert service that can text people but cannot be told to stop is not a
 * service, it is a nuisance, and in Australia it is a breach. Twilio posts the
 * message here; we act on STOP/START and answer with TwiML so the sender gets an
 * acknowledgement rather than silence.
 *
 * SIGNATURE: when TWILIO_AUTH_TOKEN is present every request must carry a valid
 * X-Twilio-Signature over the URL and the form body. With no token we cannot
 * verify anything, and an unverifiable STOP is worse than none — anyone could
 * forge one and mute a subscriber's alerts — so the route REFUSES rather than
 * trusts. Fail closed.
 *
 * LOOKUP: the sender's number is matched through a salted hash (see
 * hashContact in lib/alerts/store.ts), never by decrypting stored numbers.
 */
export const dynamic = 'force-dynamic'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { hashContact, findUserIdByContactHash, stopContact, resumeContact } from '@/lib/alerts/store.ts'

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt-out'])
const START_WORDS = new Set(['start', 'unstop', 'yes', 'subscribe', 'optin', 'opt-in'])

function twiml(message: string): Response {
  const safe = message.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`, {
    status: 200, headers: { 'Content-Type': 'text/xml' },
  })
}

/** Twilio's scheme: HMAC-SHA1 over the URL followed by each POSTed key/value, sorted. */
function validSignature(url: string, params: Record<string, string>, signature: string | null, token: string): boolean {
  if (!signature) return false
  const payload = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url)
  const expected = createHmac('sha1', token).update(Buffer.from(payload, 'utf8')).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token) {
    console.error('[twilio-inbound] refused: no TWILIO_AUTH_TOKEN, so no request can be verified')
    return new Response('not configured', { status: 503 })
  }

  const raw = await request.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v

  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const url = `${proto}://${host}${new URL(request.url).pathname}`
  if (!validSignature(url, params, request.headers.get('x-twilio-signature'), token)) {
    console.error('[twilio-inbound] refused: bad or missing X-Twilio-Signature')
    return new Response('bad signature', { status: 403 })
  }

  const from = (params.From || '').trim()
  const body = (params.Body || '').trim().toLowerCase()
  const keyword = body.split(/\s+/)[0] || ''

  const hash = from ? hashContact(from) : null
  const userId = hash ? await findUserIdByContactHash(hash) : null

  if (STOP_WORDS.has(keyword)) {
    if (userId !== null) await stopContact(userId, 'inbound-stop')
    console.log(`[twilio-inbound] STOP from ${from.slice(0, 6)}*** matched=${userId !== null}`)
    return twiml('You are unsubscribed and will receive no further text or call alerts. Reply START to resume.')
  }

  if (START_WORDS.has(keyword)) {
    if (userId !== null) await resumeContact(userId, 'sms', 'inbound-start')
    console.log(`[twilio-inbound] START from ${from.slice(0, 6)}*** matched=${userId !== null}`)
    return twiml('Alerts resumed. Reply STOP to stop them again.')
  }

  return twiml('Reply STOP to unsubscribe from alerts, or START to resume.')
}
