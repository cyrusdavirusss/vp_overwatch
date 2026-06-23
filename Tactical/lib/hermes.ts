/**
 * Hermes — Bland AI voice-alert transport for VP-Overwatch
 *
 * Hermes is the outbound-call layer of the notification engine. When a known
 * police/AFP aircraft changes state (takeoff / stealth / land), Hermes builds a
 * dynamic safety-awareness briefing from live telemetry and asks Bland AI to
 * place a call to each opted-in subscriber.
 *
 * Design principles (mirrors lib/notifications.ts):
 *   - Honest & precise: briefings only ever describe aircraft in the known
 *     registry. We never speculate about operator identity. Numbers read out
 *     are exactly the telemetry we hold, with explicit "approximately" hedging
 *     on modelled values (fuel endurance is an estimate, not a sensor reading).
 *   - Consent-first: this module never decides *who* to call. The caller is
 *     responsible for filtering to consented subscribers (see canCall in
 *     lib/notifications.ts). Hermes only knows how to place one call.
 *   - Safe by default: with no BLAND_API_KEY set, dispatch is a dry run that
 *     logs the briefing instead of dialing — same pattern as the Twilio path.
 */

export type HermesEventType = 'takeoff' | 'stealth' | 'land'

/** Telemetry subset needed to brief a subscriber. All values come straight
 *  from the Aircraft record in lib/data.ts — no derived guessing here. */
export interface AircraftBrief {
  registration: string
  callsign: string
  typeLabel: string
  altitude: number              // feet
  speed: number                 // knots (ground speed)
  heading: number               // degrees true
  fuelEnduranceMinutes: number  // modelled total endurance for the airframe
  fuelRemainingPercent: number  // modelled remaining (0-100)
  timeAirborneSeconds: number
}

const BLAND_API_URL = 'https://api.bland.ai/v1/calls'

/** True when Bland is configured. When false, dispatch is a logged dry run. */
export function hermesEnabled(): boolean {
  return Boolean(process.env.BLAND_API_KEY)
}

// ── Briefing builder ───────────────────────────────────────────────────────

function compass(deg: number): string {
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
  return points[Math.round(((deg % 360) / 45)) % 8]
}

/** Estimated minutes of fuel endurance remaining, from the modelled percent. */
function fuelMinutesRemaining(b: AircraftBrief): number {
  return Math.max(0, Math.round((b.fuelRemainingPercent / 100) * b.fuelEnduranceMinutes))
}

/** Human-readable aircraft id: prefer callsign, fall back to registration. */
function aircraftLabel(b: AircraftBrief): string {
  return b.callsign?.trim() || b.registration || 'an unidentified registry aircraft'
}

/**
 * Build the dynamic task/prompt handed to the Bland AI voice agent.
 *
 * The prompt frames Hermes as a *public-safety awareness* line, not a
 * surveillance-evasion tool, and instructs the agent to stick to the supplied
 * facts. This framing is deliberate: it keeps calls honest and keeps the use
 * case (situational awareness for civilians) explicit to anyone who answers.
 */
export function buildBriefing(eventType: HermesEventType, b: AircraftBrief): string {
  const id = aircraftLabel(b)
  const persona =
    `You are Hermes, the automated safety-awareness line for the VP-Overwatch community. ` +
    `You are calling a subscriber who opted in to receive these alerts. Speak calmly and ` +
    `clearly in Australian English. Read the briefing once, then ask if they have any ` +
    `questions about the position or status. Only state the facts given below — do not ` +
    `speculate about who is on board, why the aircraft is flying, or what anyone should do. ` +
    `If asked something you were not told, say you only relay public flight-tracking data. ` +
    `Keep the whole call under ninety seconds.`

  const minsAirborne = Math.round(b.timeAirborneSeconds / 60)
  const fuelMin = fuelMinutesRemaining(b)

  let briefing: string
  switch (eventType) {
    case 'takeoff':
      briefing =
        `Awareness update. A known police aircraft, ${id}, a ${b.typeLabel}, has just become ` +
        `airborne. It is currently at approximately ${b.altitude} feet, ${b.speed} knots, ` +
        `tracking ${compass(b.heading)} on heading ${Math.round(b.heading)} degrees. ` +
        `Estimated fuel endurance remaining is approximately ${fuelMin} minutes. ` +
        `This is a public-safety awareness call only.`
      break
    case 'stealth':
      briefing =
        `Awareness update. A known police aircraft, ${id}, a ${b.typeLabel}, that was airborne ` +
        `is no longer broadcasting its position on public tracking. Its last known altitude was ` +
        `approximately ${b.altitude} feet. We cannot confirm its current location. ` +
        `This is a public-safety awareness call only.`
      break
    case 'land':
      briefing =
        `Awareness update. A known police aircraft, ${id}, a ${b.typeLabel}, has landed after ` +
        `approximately ${minsAirborne} minutes airborne. There is no longer an active sortie ` +
        `for this aircraft. This is a public-safety awareness call only.`
      break
  }

  return `${persona}\n\nBriefing to deliver:\n${briefing}`
}

/** A short opening line Bland speaks before the model takes over. */
export function firstSentence(eventType: HermesEventType): string {
  return eventType === 'land'
    ? 'Hello, this is a VP-Overwatch awareness update.'
    : 'Hello, this is an automated VP-Overwatch awareness alert.'
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export interface HermesDispatchResult {
  ok: boolean
  dryRun: boolean
  callId?: string
  error?: string
}

/**
 * Place a single Hermes call via Bland AI.
 *
 * @param phone  subscriber phone in E.164 (e.g. "+61412345678")
 * @param task   the briefing prompt from buildBriefing()
 * @param opts   eventType drives the opening line; signal allows timeout/abort
 */
export async function dispatchHermesCall(
  phone: string,
  task: string,
  opts: { eventType: HermesEventType; signal?: AbortSignal } = { eventType: 'takeoff' }
): Promise<HermesDispatchResult> {
  const apiKey = process.env.BLAND_API_KEY
  if (!apiKey) {
    console.log(`[hermes] DRY RUN — would call ${phone} with briefing:\n${task}`)
    return { ok: false, dryRun: true }
  }

  const body: Record<string, unknown> = {
    phone_number: phone,
    task,
    first_sentence: firstSentence(opts.eventType),
    voice: process.env.BLAND_VOICE || 'nat',
    model: process.env.BLAND_MODEL || 'enhanced',
    language: 'en-AU',
    wait_for_greeting: true,
    max_duration: 2, // minutes — hard cap so a stuck call can't run up cost
    record: false,
  }
  // Optional verified caller ID, if the account has one provisioned.
  if (process.env.BLAND_FROM_NUMBER) body.from = process.env.BLAND_FROM_NUMBER

  try {
    const res = await fetch(BLAND_API_URL, {
      method: 'POST',
      headers: {
        'authorization': apiKey, // Bland expects the raw key, not "Bearer ..."
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })

    const data = await res.json().catch(() => ({} as any))
    if (!res.ok || data?.status === 'error') {
      const msg = data?.message || data?.errors || `HTTP ${res.status}`
      console.error(`[hermes] Bland call failed to ${phone}:`, msg)
      return { ok: false, dryRun: false, error: String(msg) }
    }

    return { ok: true, dryRun: false, callId: data?.call_id }
  } catch (err: any) {
    console.error(`[hermes] dispatch error to ${phone}:`, err?.message)
    return { ok: false, dryRun: false, error: err?.message || 'dispatch_failed' }
  }
}
