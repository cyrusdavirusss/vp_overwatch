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

/**
 * Channels that interrupt a human. Push and in-app do not: they wait to be looked at.
 * Email is deliberately NOT intrusive — it lands in an inbox and waits, like push.
 * That distinction is what quiet hours key off.
 */
export const INTRUSIVE_CHANNELS = ['sms', 'call'] as const
export type IntrusiveChannel = (typeof INTRUSIVE_CHANNELS)[number]

// ── Quiet hours ───────────────────────────────────────────────────────────
//
// A subscriber sets a window in which interrupting channels stay silent. The
// window is stored as two local hours (0-23) plus a timezone, because "between
// 10pm and 7am" is a statement about the wall clock where the person sleeps, not
// about UTC or the server. Nothing here reads the system clock.

export interface QuietHours {
  /** Local hour 0-23 the quiet window starts. Null/undefined means no quiet hours. */
  startHour: number | null | undefined
  /** Local hour 0-23 the quiet window ends (exclusive). */
  endHour: number | null | undefined
  /** IANA zone, e.g. Australia/Melbourne. */
  timezone?: string | null
  /**
   * Whether an event flagged urgent may interrupt anyway. Defaults to true: the
   * whole point of this system is the 3am event that matters. A subscriber who
   * turns it off has decided that being reachable matters more than being woken.
   */
  urgentBypass?: boolean | null
}

export const DEFAULT_QUIET_TIMEZONE = 'Australia/Melbourne'

/**
 * The local hour (0-23) at `nowMs` in `timezone`. Falls back to UTC if the zone is
 * unknown rather than throwing — a bad zone must not stop an alert from being sent.
 */
export function localHour(nowMs: number, timezone?: string | null): number {
  const zone = timezone || DEFAULT_QUIET_TIMEZONE
  try {
    const fmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hour12: false, timeZone: zone })
    const hour = Number(fmt.format(new Date(nowMs)))
    return Number.isFinite(hour) ? hour % 24 : new Date(nowMs).getUTCHours()
  } catch {
    return new Date(nowMs).getUTCHours()
  }
}

/**
 * Is `nowMs` inside the subscriber's quiet window?
 *
 * Handles the wrap that most implementations get wrong: a window of 22→07 runs
 * across midnight, so it is "hour >= 22 OR hour < 7", not "hour >= 22 AND hour < 7".
 * Equal start and end means an empty window, not a 24-hour one — if someone drags
 * the sliders together we stay silent about it rather than muting them forever.
 */
export function inQuietHours(nowMs: number, quiet: QuietHours | null | undefined): boolean {
  if (!quiet) return false
  const { startHour, endHour } = quiet
  if (typeof startHour !== 'number' || typeof endHour !== 'number') return false
  if (startHour === endHour) return false

  const hour = localHour(nowMs, quiet.timezone)
  if (startHour < endHour) return hour >= startHour && hour < endHour
  // Wraps midnight.
  return hour >= startHour || hour < endHour
}

export interface DispatchContext {
  nowMs?: number
  quiet?: QuietHours | null
  /** Set by the event itself when the event is urgent (a proximity entry, not a routine takeoff). */
  urgent?: boolean
}

/**
 * May an alert go out on this channel right now?
 *
 * Order of refusal, and the reasons are recorded because "why didn't I get
 * anything?" deserves a better answer than a shrug:
 *  1. non-intrusive channels are always allowed;
 *  2. an urgent event bypasses quiet hours when the subscriber left the bypass on;
 *  3. otherwise quiet hours hold intrusive channels.
 */
export function mayDispatchNow(channel: string, ctx: DispatchContext = {}): DispatchDecision {
  const intrusive = (INTRUSIVE_CHANNELS as readonly string[]).includes(channel)
  if (!intrusive) return { allowed: true, outageSeconds: null }

  const nowMs = ctx.nowMs ?? Date.now()
  if (ctx.urgent && (ctx.quiet?.urgentBypass ?? true)) return { allowed: true, outageSeconds: null }

  if (inQuietHours(nowMs, ctx.quiet)) {
    const hour = localHour(nowMs, ctx.quiet?.timezone)
    return {
      allowed: false,
      reason: `quiet hours (${ctx.quiet?.startHour}:00-${ctx.quiet?.endHour}:00 ${ctx.quiet?.timezone || DEFAULT_QUIET_TIMEZONE}, now ${hour}:00) — held for a non-urgent event`,
      outageSeconds: null,
    }
  }
  return { allowed: true, outageSeconds: null }
}

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
