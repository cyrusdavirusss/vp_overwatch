/**
 * A mock flight, for reviewing the map when nothing real is airborne.
 *
 * ── GATED AND LABELLED, DELIBERATELY ───────────────────────────────────────────────
 * Only active behind an explicit `?mock=1` in the URL, and the map draws a MOCK strip
 * while it is on. This application's standing rule is that it never implies more certainty
 * than it has, and synthetic aircraft that looked like real tracking would break that
 * outright — nobody should be able to open a stale tab, or look at a screenshot, and
 * believe a King Air was over Melbourne. The aircraft are also named MOCK … for the same
 * reason.
 *
 * Two airframes on purpose, because the two roles render AND model differently:
 *   rotary     a helicopter orbiting a point — steep look-down, wide scan, low altitude
 *   fixedwing  a King Air crossing the metro — forward flight, shallower look-down
 *
 * Positions are a pure function of the clock, so a refresh resumes where it left off and
 * two browsers watching the same URL see the same thing. The trail is generated backwards
 * from now in the same 3-second cadence the real feed uses, so the trail, the dead-reckoning
 * between polls and the vision cones all exercise the production paths rather than a
 * special case.
 */
import type { Aircraft, TrackPoint } from './data'

/** Same cadence as the real poll, so interpolation behaves identically. */
const STEP_MS = 3_000
/** How much trail to synthesise. */
const TRACK_SECONDS = 180

const METRES_PER_DEG_LAT = 111_320
const ORBIT_CENTRE = { lat: -37.8136, lng: 144.9631 } // Melbourne CBD
const ORBIT_RADIUS_M = 2_000
const ORBIT_PERIOD_S = 300 // 5 minutes per lap — a plausible surveillance orbit
const ORBIT_ALT_FT = 1_200

const LEG_FROM = { lat: -37.72, lng: 144.72 }
const LEG_TO = { lat: -38.05, lng: 145.24 }
const LEG_PERIOD_S = 600 // time to fly the leg once, then it repeats
// 6,000 ft rather than a King Air's real 25,000: this is a review fixture, and an unaided
// eye at 25,000 ft has no cone at all (see lib/pilot-vision.ts), which would demonstrate
// the model but show nothing. At 6,000 ft both airframes render a cone, so the two
// profiles can actually be compared side by side.
const LEG_ALT_FT = 6_000

const mToLat = (m: number) => m / METRES_PER_DEG_LAT
const mToLng = (m: number, lat: number) => m / (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))

/** Bearing from A to B, degrees clockwise from north. */
function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** The helicopter's position on its orbit at a given moment. */
function orbitAt(nowMs: number) {
  const t = (nowMs / 1000) % ORBIT_PERIOD_S
  const θ = (t / ORBIT_PERIOD_S) * 2 * Math.PI
  const lat = ORBIT_CENTRE.lat + mToLat(ORBIT_RADIUS_M * Math.cos(θ))
  const lng = ORBIT_CENTRE.lng + mToLng(ORBIT_RADIUS_M * Math.sin(θ), ORBIT_CENTRE.lat)
  // Tangent to the circle: the aircraft flies across its own radius.
  const heading = ((((θ * 180) / Math.PI) + 90) % 360 + 360) % 360
  return { lat, lng, heading, speedKt: 90, altFt: ORBIT_ALT_FT }
}

/** The fixed wing's position along its leg at a given moment. */
function legAt(nowMs: number) {
  const frac = ((nowMs / 1000) % LEG_PERIOD_S) / LEG_PERIOD_S
  const lat = LEG_FROM.lat + (LEG_TO.lat - LEG_FROM.lat) * frac
  const lng = LEG_FROM.lng + (LEG_TO.lng - LEG_FROM.lng) * frac
  return { lat, lng, heading: bearingDeg(LEG_FROM, LEG_TO), speedKt: 220, altFt: LEG_ALT_FT }
}

function trackFor(nowMs: number, at: (t: number) => { lat: number; lng: number; heading: number; speedKt: number; altFt: number }): TrackPoint[] {
  const points: TrackPoint[] = []
  const steps = Math.floor(TRACK_SECONDS / (STEP_MS / 1000))
  for (let k = steps; k >= 0; k--) {
    const t = nowMs - k * STEP_MS
    const p = at(t)
    points.push({
      t: -k * (STEP_MS / 1000), // legacy relative field
      ts: t,                    // absolute: what the trail and dead-reckoning use
      lat: p.lat,
      lng: p.lng,
      alt: p.altFt,
      hdg: p.heading,
      spd: p.speedKt,
      vs: 0,
    })
  }
  return points
}

function base(id: string, hex: string, registration: string, callsign: string, label: string,
              role: 'rotary' | 'fixedwing', type: string, typeLabel: string, nowMs: number,
              pos: { lat: number; lng: number; heading: number; speedKt: number; altFt: number },
              track: TrackPoint[], enduranceMin: number, fuelPct: number): Aircraft {
  const airborneSec = 2_700 + ((nowMs / 1000) % 600)  // ~45 min into a sortie, advancing
  const historical = role === 'rotary' ? 42 * 60 : 95 * 60
  return {
    id, hex, registration, callsign, label,
    type, typeLabel, role,
    operator: 'MOCK — not real traffic', operatorShort: 'MOCK',
    startTime: nowMs - airborneSec * 1000,
    timeAirborneSeconds: airborneSec,
    historicalAverageSeconds: historical,
    estimatedReturnSeconds: Math.max(0, historical - airborneSec),
    altitude: pos.altFt,
    speed: pos.speedKt,
    heading: pos.heading,
    latitude: pos.lat,
    longitude: pos.lng,
    track,
    isActive: true,
    lastSeen: nowMs,
    fuelEnduranceMinutes: enduranceMin,
    fuelRemainingPercent: fuelPct,
    source: 'adsb',
  }
}

/**
 * The two mock aircraft at a given moment. Pure: same `nowMs` in, same aircraft out.
 */
export function mockAircraft(nowMs: number = Date.now()): Aircraft[] {
  const heliPos = orbitAt(nowMs)
  const wingPos = legAt(nowMs)
  return [
    base('mock-rotary', 'MOCK01', 'MOCK-01', 'MOCK1', 'MOCK AW139 (review only)',
      'rotary', 'AW139', 'Leonardo AW139 (mock)', nowMs, heliPos,
      trackFor(nowMs, orbitAt), 274, 62),
    base('mock-fixedwing', 'MOCK02', 'MOCK-02', 'MOCK2', 'MOCK King Air (review only)',
      'fixedwing', 'B350', 'Beechcraft King Air 350ER (mock)', nowMs, wingPos,
      trackFor(nowMs, legAt), 690, 78),
  ]
}

/** Is mock mode requested? Explicit flag only, never a default and never persisted. */
export function mockRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get('mock') === '1'
  } catch {
    return false
  }
}

// ── Named scenarios ────────────────────────────────────────────────────────────────
//
// A scenario is a fixed set of mock contacts at known coordinates, so a review or a
// demonstration can be reproduced from a URL alone: ?mock=overseas-drive.
// Still gated exactly like the flight, and still labelled MOCK on every contact — the
// standing rule is that nothing synthetic may ever look like real tracking.

/** Overseas Drive, Noble Park North 3174 — OSM way 24335407, its endpoints and midpoint. */
export const OVERSEAS_DRIVE_UNITS: { lat: number; lng: number; label: string }[] = [
  { lat: -37.9570155, lng: 145.1836598, label: 'Overseas Dr — west end' },
  { lat: -37.9528686, lng: 145.1882034, label: 'Overseas Dr — middle' },
  { lat: -37.9503919, lng: 145.1850986, label: 'Overseas Dr — east end' },
]

/**
 * One stationary mock unit. Altitude 0 and speed 0 on purpose: these are units ON a
 * street, so the map draws them as ground contacts and the vision-cone model correctly
 * gives them no forward view (an aircraft on the ground has none — see pilot-vision).
 */
function unit(id: string, n: number, at: { lat: number; lng: number; label: string }, nowMs: number): Aircraft {
  // A track of identical fixes: enough for the trail and dead-reckoning to run, and flat
  // enough that the sensor-pointing estimator declines to invent a direction for it.
  const track: TrackPoint[] = []
  for (let k = 6; k >= 0; k--) {
    track.push({ t: -k * 3, ts: nowMs - k * STEP_MS, lat: at.lat, lng: at.lng, alt: 0, hdg: 0, spd: 0, vs: 0 })
  }
  return {
    id,
    hex: `MOCKU${n}`,
    registration: `MOCK-U${n}`,
    callsign: `MOCKU${n}`,
    label: `MOCK UNIT ${n} — ${at.label}`,
    type: 'UNIT',
    typeLabel: `Mock ground unit (${at.label})`,
    role: 'rotary',
    operator: 'MOCK — not real traffic', operatorShort: 'MOCK',
    startTime: nowMs,
    timeAirborneSeconds: 0,
    historicalAverageSeconds: 0,
    estimatedReturnSeconds: 0,
    altitude: 0,
    speed: 0,
    heading: 0,
    latitude: at.lat,
    longitude: at.lng,
    track,
    isActive: true,
    lastSeen: nowMs,
    fuelEnduranceMinutes: 0,
    fuelRemainingPercent: 0,
    source: 'adsb',
  }
}

/** Which mock was asked for, if any. Explicit flag only — never a default, never persisted. */
export type MockScenario = 'flight' | 'overseas-drive'
export function mockScenario(search: string): MockScenario | null {
  try {
    const v = new URLSearchParams(search).get('mock')
    if (v === '1' || v === 'flight') return 'flight'
    if (v === 'overseas-drive') return 'overseas-drive'
    return null
  } catch {
    return null
  }
}

/** The contacts for a scenario at a given moment. */
export function mockContacts(scenario: MockScenario, nowMs: number = Date.now()): Aircraft[] {
  if (scenario === 'overseas-drive') {
    return OVERSEAS_DRIVE_UNITS.map((at, i) => unit(`mock-unit-${i + 1}`, i + 1, at, nowMs))
  }
  return mockAircraft(nowMs)
}
