/**
 * Alert dispatch policy — the rules that decide whether an alert is ALLOWED to go out,
 * kept separate from the code that sends it.
 *
 * The operator's rule, in his words: "[for] the call or sms don't initiate [if the]
 * chopper goes invisible for less than 60 seconds". A brief telemetry gap is routine —
 * coverage holes, a receiver handover, a provider hiccup — and ringing a phone for one
 * trains the user to ignore the phone.
 *
 * Two properties matter more than the exact number:
 *
 *  FAIL CLOSED. If the outage cannot be measured (no last-observed timestamp, an
 *  unparseable one, a clock that says the aircraft was seen in the future), the
 *  intrusive channels are refused. An unmeasured gap is not evidence of a gap, and a
 *  phone call is not a good way to find out.
 *
 *  STRICTLY A FLOOR. The threshold here is a minimum, not the trigger. The state machine
 *  declares an aircraft unavailable only after ~300s, so in practice a lost-signal alert
 *  is dispatched well after this floor; if that ever changes, this still holds.
 */

/** Channels that interrupt a human. Push and in-app do not: they wait to be looked at. */
export const INTRUSIVE_CHANNELS = ['sms', 'call'] as const
export type IntrusiveChannel = (typeof INTRUSIVE_CHANNELS)[number]

/** Default floor, in seconds, before an intrusive lost-signal alert may leave the server. */
export const DEFAULT_STEALTH_MIN_OUTAGE_SECONDS = 60

export function stealthMinOutageSeconds(): number {
  const raw = Number(process.env.STEALTH_MIN_OUTAGE_SECONDS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_STEALTH_MIN_OUTAGE_SECONDS
}

/**
 * How long an aircraft has been unseen, in seconds. Returns null when it cannot be
 * measured — the caller must treat null as "do not interrupt anyone".
 */
export function lostSignalOutageSeconds(lastObservedAt: number | null | undefined, nowMs: number = Date.now()): number | null {
  if (typeof lastObservedAt !== 'number' || !Number.isFinite(lastObservedAt)) return null
  const seconds = (nowMs - lastObservedAt) / 1000
  // A negative age means the clocks disagree; that is not a measured outage either.
  if (seconds < 0) return null
  return seconds
}

export type DispatchDecision =
  | { allowed: true; outageSeconds: number | null }
  | { allowed: false; reason: string; outageSeconds: number | null }

/**
 * May a lost-signal alert go out on this channel?
 *
 * Non-intrusive channels are always allowed — a row in a dashboard or a quiet push costs
 * nobody a night's sleep. Intrusive ones must clear the floor on a MEASURED outage.
 */
export function mayDispatchLostSignal(
  channel: string,
  outageSeconds: number | null,
  minSeconds: number = stealthMinOutageSeconds(),
): DispatchDecision {
  const intrusive = (INTRUSIVE_CHANNELS as readonly string[]).includes(channel)
  if (!intrusive) return { allowed: true, outageSeconds }

  if (outageSeconds === null) {
    return {
      allowed: false,
      reason: 'outage could not be measured, so no intrusive alert was sent (fail closed)',
      outageSeconds: null,
    }
  }
  if (outageSeconds < minSeconds) {
    return {
      allowed: false,
      reason: `unseen for ${outageSeconds.toFixed(1)}s, under the ${minSeconds}s floor — treated as a coverage gap, not a lost aircraft`,
      outageSeconds,
    }
  }
  return { allowed: true, outageSeconds }
}
