/**
 * Is this police contact on the ground?
 *
 * Low AND slow is the obvious test, and it is wrong for the most common case there is.
 * A police aircraft switches its transponder off on the apron a minute or two AFTER it
 * lands, so the last frames the feed carries are the landing ROLL: barometric altitude at
 * field level, groundspeed still 50-100 kt. Requiring <=30 kt meant those aircraft were
 * never judged landed. The contact stayed flagged airborne and kept burning fuel on the
 * map until its tank ran dry — hours later, at its home base.
 *
 * Two routes are therefore accepted:
 *
 *   1. Low AND slow — the parked, still-transmitting case. Unchanged.
 *   2. Low AND decelerating with no climb, read off the recent track — the rollout.
 *
 * The second route is deliberately narrow. A low pass or a go-around is level or climbing
 * and is not slowing toward a stop, so it stays SILENT, which matters: "went dark in the
 * air" is the exact event this app exists to flag, and the landing rule must not swallow
 * it. Anything above the ground threshold never qualifies, whatever its speed.
 */

/** Feet. Melbourne airfields sit ~280-430 ft MSL, so this is "at or near field level". */
export const LANDED_ALT_FT = 500

/** Knots. Below this, a contact is parked rather than rolling out. */
export const LANDED_SPD_KT = 30

/**
 * A rollout must shed at least this much speed across the window to count as decelerating.
 *
 * This started at 1 kt, and a unit test caught what that meant: a level low pass with
 * ordinary speed noise (110, 112, 110) "decelerated" by 2 kt and was called a landing —
 * i.e. the rule would have swallowed a dark aircraft as landed, which is the one error
 * this app cannot afford. Real rollouts shed far more than noise: the measured cases were
 * 150->104 kt and 110->55 kt. Ten knots sits between the two populations with room either
 * side, and a genuine rollout that somehow sheds less than that (a very long runway,
 * sampled coarsely) keeps the 15-minute low-altitude backstop instead.
 */
export const ROLLOUT_MIN_SLOWDOWN_KT = 10

/** ...and must not have climbed more than this over the same window. */
export const ROLLOUT_MAX_ALT_RISE_FT = 25

/**
 * ...and the window must actually span time. Three frames stamped the same second are not
 * a trend, and treating them as one is another way to invent a landing out of noise.
 */
export const ROLLOUT_MIN_SPAN_MS = 4_000

/**
 * Backstop for the case where the track carries no usable trend: silence from a contact
 * last seen at field altitude. An aircraft that goes dark at ground level is parked; one
 * that goes dark on task is at cruise, and that keeps holding as silent.
 */
export const LOW_ALT_SILENT_LANDED_MS = 15 * 60_000

interface TrackSample {
  ts?: number
  alt: number
  spd: number
}

export function looksLanded(
  altFt: number | null | undefined,
  spdKt: number | null | undefined,
  track?: TrackSample[] | null,
): boolean {
  const alt = typeof altFt === 'number' && Number.isFinite(altFt) ? altFt : NaN
  if (!Number.isFinite(alt) || alt > LANDED_ALT_FT) return false

  const spd = typeof spdKt === 'number' && Number.isFinite(spdKt) ? spdKt : NaN
  if (Number.isFinite(spd) && spd <= LANDED_SPD_KT) return true

  // Rollout. Sorted by absolute timestamp: array order is not promised, and the trail is
  // appended from a few different paths.
  const pts = (track ?? []).filter(
    (p) => p && Number.isFinite(p.alt) && Number.isFinite(p.spd)
  )
  if (pts.length >= 2) {
    const sorted = [...pts].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    const last = sorted[sorted.length - 1]
    // Compare against the fastest of the preceding few samples rather than only the one
    // before: a single frame is noisy, and the feed's last frame often repeats.
    const recent = sorted.slice(-5, -1)
    if (recent.length > 0) {
      const span = (last.ts ?? 0) - (recent[0].ts ?? 0)
      if (span >= ROLLOUT_MIN_SPAN_MS) {
        const prevSpd = Math.max(...recent.map((p) => p.spd))
        const prevAltMin = Math.min(...recent.map((p) => p.alt))
        const slowing = prevSpd - last.spd >= ROLLOUT_MIN_SLOWDOWN_KT
        const noClimb = last.alt - prevAltMin <= ROLLOUT_MAX_ALT_RISE_FT
        if (slowing && noClimb) return true
      }
    }
  }
  return false
}
