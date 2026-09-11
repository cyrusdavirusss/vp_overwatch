/**
 * Geodesic distance + proximity hysteresis.
 * ────────────────────────────────────────────────────────────────────────────
 * Pure functions only — no I/O, no clock. Used server-side to decide
 * `proximity_enter` events for authenticated users. Distances are in METRES.
 */

const EARTH_RADIUS_M = 6_371_008.8 // IUGG mean Earth radius

export interface LatLng {
  lat: number
  lng: number
}

const toRad = (deg: number): number => (deg * Math.PI) / 180

/**
 * Great-circle distance between two points, in metres, via the haversine
 * formula. Returns NaN if any coordinate is non-finite so callers can treat
 * unknown positions as "no decision" rather than distance 0.
 */
export function haversineMetres(a: LatLng, b: LatLng): number {
  if (
    !Number.isFinite(a.lat) || !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) || !Number.isFinite(b.lng)
  ) {
    return NaN
  }
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const DEFAULT_ENTER_METRES = 30_000
export const DEFAULT_EXIT_METRES = 33_000

/**
 * Per-user/per-aircraft proximity arming state. `armed` means we are eligible
 * to fire a new `proximity_enter`; once fired we disarm until the aircraft has
 * moved back outside the (larger) exit radius, preventing alert flapping at the
 * boundary.
 */
export interface ProximityState {
  armed: boolean
  inside: boolean
}

export function initialProximityState(): ProximityState {
  return { armed: true, inside: false }
}

export interface ProximityConfig {
  enterMetres: number
  exitMetres: number
}

export const DEFAULT_PROXIMITY_CONFIG: ProximityConfig = {
  enterMetres: DEFAULT_ENTER_METRES,
  exitMetres: DEFAULT_EXIT_METRES,
}

export interface ProximityDecision {
  state: ProximityState
  fired: boolean          // true → emit a proximity_enter event this step
  distanceMetres: number  // NaN when position/user location unknown
}

/**
 * Advance the hysteresis state machine by one observation.
 *
 * Rules:
 *   • Unknown distance (NaN) → no change, no fire.
 *   • Cross from outside→at-or-inside enterMetres while armed → fire, disarm.
 *   • Reach at-or-beyond exitMetres → re-arm (ready to fire again on re-entry).
 *   • Between the two radii → carry state (this is the anti-flap band).
 *
 * Config must satisfy exitMetres >= enterMetres; otherwise the exit test uses
 * enterMetres to stay safe.
 */
export function stepProximity(
  prev: ProximityState,
  aircraft: LatLng,
  user: LatLng,
  config: ProximityConfig = DEFAULT_PROXIMITY_CONFIG,
): ProximityDecision {
  const distance = haversineMetres(aircraft, user)
  if (!Number.isFinite(distance)) {
    return { state: prev, fired: false, distanceMetres: distance }
  }

  const enter = config.enterMetres
  const exit = Math.max(config.exitMetres, config.enterMetres)

  let { armed } = prev
  let fired = false
  const inside = distance <= enter

  if (inside && armed) {
    fired = true
    armed = false
  } else if (distance >= exit) {
    armed = true
  }

  return { state: { armed, inside }, fired, distanceMetres: distance }
}
