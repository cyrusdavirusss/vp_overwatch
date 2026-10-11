/**
 * Dead-reckoning position extrapolation (pure).
 * ────────────────────────────────────────────────────────────────────────────
 * Between provider polls, a marker's true position advances. Rather than let it
 * sit stale for up to a poll interval (the 30 s / ~1.8 km drift), we advance the
 * last known fix along its heading at its ground speed. Extrapolation is capped
 * so a long gap (or a lost aircraft) never flings a marker across the map.
 */
export interface Fix {
  lat: number
  lng: number
  headingDeg: number | null
  groundSpeedKt: number | null
}

const KT_TO_MS = 0.514444
const MAX_EXTRAPOLATION_SEC = 30

/**
 * Advance a fix by `elapsedSec`. Returns the original position when heading or
 * speed is unknown, speed is ~0, or elapsed is non-positive — never invents
 * motion. Elapsed is clamped to MAX_EXTRAPOLATION_SEC.
 */
export function deadReckon(fix: Fix, elapsedSec: number): { lat: number; lng: number } {
  if (
    fix.headingDeg === null || fix.groundSpeedKt === null ||
    fix.groundSpeedKt <= 1 || !Number.isFinite(elapsedSec) || elapsedSec <= 0 ||
    !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)
  ) {
    return { lat: fix.lat, lng: fix.lng }
  }
  const t = Math.min(elapsedSec, MAX_EXTRAPOLATION_SEC)
  const metres = fix.groundSpeedKt * KT_TO_MS * t
  const brng = (fix.headingDeg * Math.PI) / 180
  const dLat = (metres * Math.cos(brng)) / 111_320
  const cosLat = Math.cos((fix.lat * Math.PI) / 180)
  const dLng = cosLat > 1e-6 ? (metres * Math.sin(brng)) / (111_320 * cosLat) : 0
  return { lat: fix.lat + dLat, lng: fix.lng + dLng }
}

export { MAX_EXTRAPOLATION_SEC }
