/**
 * When a feed's position fix was ACTUALLY observed.
 * ────────────────────────────────────────────────────────────────────────────
 * A feed serves its LATEST KNOWN position and re-serves it on every poll, whether or not
 * a new position message has arrived since. `seen_pos` is how old that position is, in
 * seconds, at the moment the feed answered — and in the live feed it is not rounding
 * noise. Measured across the 60 contacts in range on 2026-09-29: median 0.3 s, 90th
 * percentile 26 s, oldest 59 s.
 *
 * Stamping such a fix with the RECEIVE time is what makes a tracked airframe look like it
 * freezes and then jumps. The map draws each fix at its own timestamp and dead-reckons
 * forward from there, so a fix stamped "now" tells the map the aircraft is still sitting
 * where it was up to a minute ago; when the next genuine position lands, the marker leaps
 * forward by everything flown in between, and the breadcrumb trail shows a gap followed
 * by a long straight jump. A track point therefore carries the time the position was
 * OBSERVED, never our arrival time.
 *
 * The feed's own clock (`now` in the response, ms) is preferred over ours so that request
 * latency and any skew between the two machines cancel out — but only while it is
 * plausible, because a wildly wrong provider clock must not be allowed to date every fix
 * on the map.
 */

/** Oldest observation age we will believe. Past this the contact is stale, not merely late. */
export const MAX_FIX_AGE_SEC = 120

/** How far the feed's clock may differ from ours before we stop trusting it. */
export const PROVIDER_CLOCK_TOLERANCE_MS = 5 * 60_000

/**
 * The instant a fix was observed, in epoch ms.
 *
 * `providerNowMs` is the feed's own `now` (optional). `seenPosSec` is the feed's
 * `seen_pos`. `localNowMs` is our receive time, used when the feed gives us nothing
 * usable — the honest fallback, since it can only make a fix look fresher than it is by
 * the age we failed to read.
 */
export function observedFixMs(
  providerNowMs: number | null | undefined,
  seenPosSec: number | null | undefined,
  localNowMs: number,
): number {
  const local = Number.isFinite(localNowMs) ? localNowMs : Date.now()
  const provider =
    typeof providerNowMs === 'number' && Number.isFinite(providerNowMs) &&
    Math.abs(providerNowMs - local) <= PROVIDER_CLOCK_TOLERANCE_MS
      ? providerNowMs
      : local

  if (typeof seenPosSec !== 'number' || !Number.isFinite(seenPosSec) || seenPosSec <= 0) {
    return provider
  }
  return provider - Math.min(seenPosSec, MAX_FIX_AGE_SEC) * 1000
}
