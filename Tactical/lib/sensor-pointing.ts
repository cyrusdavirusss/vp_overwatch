/**
 * Where is the sensor looking?
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────────────
 * An EO/IR turret is not fixed to the nose. The tactical flight officer points it with a
 * console — Victoria Police describe it as a "beefed-up PlayStation controller" — and the
 * aircraft's own account of a night's work is full of the crew moving the camera
 * independently of where the aircraft is going. So a cone drawn along the nose is wrong
 * most of the time the aircraft is doing its job.
 *
 * ── WHAT CAN ACTUALLY BE KNOWN ─────────────────────────────────────────────────────
 * The turret's pointing angle is not broadcast. ADS-B carries position, altitude, ground
 * speed and track — nothing about the camera. So this cannot be measured, only inferred,
 * and the honest output is a bearing WITH an uncertainty, never a bearing alone.
 *
 * Three inferences, in descending order of strength:
 *
 * 1. ORBIT CENTRE. Police aircraft work by orbiting what they are watching: the aircrew
 *    keeps the target under the camera by circling it. When the recent track closes a
 *    loop, the centre of that loop is where the aircraft is working, and the camera is
 *    pointed at it. This is the strongest signal available, because the orbit geometry
 *    and the camera direction are the same fact expressed twice. A least-squares circle
 *    fit to the track gives the centre; the fit residual says how much to trust it.
 *
 * 2. GROUND CONTACT. If a confirmed police contact — a Waze sighting, a community pin —
 *    sits inside the sensor's reach, the aircraft is plausibly watching that. Weaker than
 *    an orbit, and it is a prior rather than a deduction, so it only nudges the bearing.
 *
 * 3. ALONG-TRACK. Failing both, during ordinary transit the camera most often looks
 *    ahead. This is the fallback, not the assumption — it is what used to be drawn
 *    unconditionally, which is why the cone read as wrong.
 *
 * ── WHY IT RETURNS A SPREAD ────────────────────────────────────────────────────────
 * The map draws the spread as the cone's width. A confident orbit estimate gets a narrow
 * cone; a bare along-track fallback gets a wide one. The uncertainty is therefore visible
 * in the thing the operator is looking at, rather than hidden in a number they are not.
 */
import type { TrackPoint } from '@/lib/data'

const DEG = Math.PI / 180
const EARTH_R_M = 6371000

export interface PointingInput {
  /** Recent track, oldest → newest. Fewer than MIN_FIXES returns the fallback. */
  track: TrackPoint[]
  /** The aircraft's own heading, used for the fallback. */
  headingDeg: number | null
  /** Ground speed in knots; transit is only inferred when actually moving. */
  groundSpeedKt: number | null
  /** Ground contacts the aircraft might be watching, with an optional 0..1 weight. */
  contacts?: Array<{ lat: number; lng: number; weight?: number }>
  /** How far the sensor reaches, in metres — contacts outside this are ignored. */
  reachM?: number
}

export type PointingBasis = 'orbit-centre' | 'ground-contact' | 'along-track' | 'nose'

export interface PointingEstimate {
  /** Degrees from north. Always set — falls back to the nose. */
  bearingDeg: number
  /** Half-width of the uncertainty sector, in degrees. Drawn as the cone's width. */
  spreadDeg: number
  confidence: 'high' | 'medium' | 'low'
  basis: PointingBasis
  /** The fitted orbit centre, when basis is orbit-centre. */
  orbitCentre?: { lat: number; lng: number }
  /** Fitted orbit radius in metres. */
  orbitRadiusM?: number
  /** Why the estimate is what it is — for the tooltip, so the operator can discount it. */
  note: string
}

export const MIN_FIXES = 6
export const MIN_ORBIT_RADIUS_M = 150
export const MAX_ORBIT_RADIUS_M = 5000
/** Start-to-end distance over path length: 0 = closed loop, 1 = straight line. */
export const MAX_ORBIT_OPENNESS = 0.55
/** Coefficient of variation of distance from the fitted centre — how circular it is. */
export const MAX_ORBIT_RADIUS_CV = 0.35
/** Below this the aircraft is not "transiting" in any meaningful sense. */
export const TRANSIT_MIN_KT = 40
/** Spreads, in degrees half-width, per basis. */
export const SPREAD = { orbit: 16, contact: 22, alongTrack: 28, nose: 30 } as const

function toRad(d: number) { return d * DEG }
function toDeg(r: number) { return r / DEG }

/** Local equirectangular metres, good to well under a metre across a few km. */
function project(p: { lat: number; lng: number }, lat0: number): [number, number] {
  const x = toRad(p.lng) * EARTH_R_M * Math.cos(toRad(lat0))
  const y = toRad(p.lat) * EARTH_R_M
  return [x, y]
}

/** Initial bearing from a to b, degrees from north. */
export function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Metres between two points (haversine, adequate at these scales). */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat)
  const dφ = φ2 - φ1, dλ = toRad(b.lng - a.lng)
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Length of the track, in metres. */
export function pathLengthM(track: Array<{ lat: number; lng: number }>): number {
  let total = 0
  for (let i = 1; i < track.length; i++) total += distanceM(track[i - 1], track[i])
  return total
}

/**
 * Least-squares circle fit (Kasa). Returns centre and radius in the local projected frame,
 * unprojected back to lat/lng, plus the residual so callers can judge the fit.
 *
 * Kasa solves the linear system for x²+y² + Dx + Ey + F = 0, so it is exact for a true
 * circle and tolerant of the small noise in a track, at the cost of a slight bias when
 * the arc spans very little angle — which is why the caller also checks how much of the
 * circle the track actually covers.
 */
export function fitCircle(
  track: Array<{ lat: number; lng: number }>,
  lat0: number,
): { centre: { lat: number; lng: number }; radiusM: number; residualM: number } | null {
  const n = track.length
  if (n < 3) return null
  const raw = track.map((p) => project(p, lat0))

  // CENTRE THE COORDINATES FIRST, and this is not tidiness. Projected from the equator,
  // these y-values are around 1.6e7 m, so x^2 and y^2 are ~1e14 and the 3x3 determinant is
  // a difference of numbers of that magnitude — the fit loses most of its significant
  // digits to cancellation and returns garbage (it did: a perfect synthetic orbit failed to
  // be recognised). Fitting around the centroid keeps every term small.
  let mx = 0, my = 0
  for (const [x, y] of raw) { mx += x; my += y }
  mx /= n; my /= n
  const pts = raw.map(([x, y]) => [x - mx, y - my] as [number, number])

  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0
  for (const [x, y] of pts) {
    const z = x * x + y * y
    Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]]
  const b = [-Sxz, -Syz, -Sz]
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det3(A)
  if (Math.abs(D) < 1e-9) return null // collinear: a straight line, not a circle
  const replace = (m: number[][], col: number, v: number[]) =>
    m.map((row, i) => row.map((val, j) => (j === col ? v[i] : val)))
  const Dx = det3(replace(A, 0, b))
  const Dy = det3(replace(A, 1, b))
  const Df = det3(replace(A, 2, b))
  const Dc = Dx / D, Ec = Dy / D, Fc = Df / D

  const cx = -Dc / 2, cy = -Ec / 2
  const radius = Math.sqrt(Math.max(0, cx * cx + cy * cy - Fc))
  if (!Number.isFinite(radius) || radius <= 0) return null

  let residual = 0
  for (const [x, y] of pts) residual += Math.abs(Math.hypot(x - cx, y - cy) - radius) ** 2
  residual = Math.sqrt(residual / n)

  // Undo the centring before unprojecting, or the centre lands near the projection origin.
  const cxW = cx + mx
  const cyW = cy + my
  return {
    centre: { lat: cyW / EARTH_R_M / DEG, lng: cxW / (EARTH_R_M * Math.cos(toRad(lat0))) / DEG },
    radiusM: radius,
    residualM: residual,
  }
}

/** Coefficient of variation of the distance of each fix from a point. 0 = perfect circle. */
export function radiusCV(track: Array<{ lat: number; lng: number }>, centre: { lat: number; lng: number }): number {
  const ds = track.map((p) => distanceM(p, centre))
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length
  if (mean <= 0) return Infinity
  const varSum = ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length
  return Math.sqrt(varSum) / mean
}

/** Turn a difference into the range (-180, 180]. */
export function normaliseDelta(d: number): number {
  let x = ((d + 180) % 360 + 360) % 360 - 180
  if (x === -180) x = 180
  return x
}

/** Weighted circular mean of bearings. */
export function circularMean(pairs: Array<{ deg: number; weight: number }>): number {
  let sx = 0, sy = 0
  for (const { deg, weight } of pairs) {
    sx += Math.cos(toRad(deg)) * weight
    sy += Math.sin(toRad(deg)) * weight
  }
  return (toDeg(Math.atan2(sy, sx)) + 360) % 360
}

/**
 * Estimate where the sensor is pointed. Never returns null: the fallback (the nose) is a
 * legitimate answer and the caller should draw it, just without pretending to confidence.
 */
export function estimateSensorPointing(input: PointingInput): PointingEstimate {
  const { track, headingDeg, groundSpeedKt, contacts, reachM } = input
  const nose = ((headingDeg ?? 0) + 360) % 360
  const last = track.length > 0 ? track[track.length - 1] : null

  const fallback = (): PointingEstimate => ({
    bearingDeg: nose,
    spreadDeg: SPREAD.nose,
    confidence: 'low',
    basis: 'nose',
    note: 'No track to infer from — drawn on the nose, not a claim about the camera.',
  })

  if (!last || track.length < MIN_FIXES) return fallback()

  // ── 1. Orbit centre ──────────────────────────────────────────────────────────────
  const len = pathLengthM(track)
  const direct = distanceM(track[0], last)
  const openness = len > 0 ? direct / len : 1
  let orbit: PointingEstimate | null = null

  if (len > 0 && openness <= MAX_ORBIT_OPENNESS) {
    const fit = fitCircle(track, last.lat)
    if (fit && fit.radiusM >= MIN_ORBIT_RADIUS_M && fit.radiusM <= MAX_ORBIT_RADIUS_M) {
      const cv = radiusCV(track, fit.centre)
      if (cv <= MAX_ORBIT_RADIUS_CV) {
        const toCentre = distanceM(last, fit.centre)
        // Very close to the centre means the geometry no longer fixes a direction.
        if (toCentre > 60) {
          orbit = {
            bearingDeg: bearingDeg(last, fit.centre),
            spreadDeg: SPREAD.orbit,
            confidence: cv < 0.18 && fit.residualM < fit.radiusM * 0.25 ? 'high' : 'medium',
            basis: 'orbit-centre',
            orbitCentre: fit.centre,
            orbitRadiusM: fit.radiusM,
            note: `Orbiting: track closes a ${Math.round(fit.radiusM)} m loop (openness ${openness.toFixed(2)}, radius CV ${cv.toFixed(2)}). Camera assumed on the loop centre.`,
          }
        }
      }
    }
  }
  if (orbit) return orbit

  // ── 2. Ground contact inside the sensor's reach ─────────────────────────────────
  if (contacts && contacts.length && reachM && reachM > 0) {
    const inReach = contacts
      .map((c) => ({ c, d: distanceM(last, c) }))
      .filter((x) => x.d <= reachM)
      .sort((a, b) => (a.d - b.d) || ((b.c.weight ?? 0) - (a.c.weight ?? 0)))
    if (inReach.length) {
      const dir = bearingDeg(last, inReach[0].c)
      const alongTrack = (groundSpeedKt ?? 0) >= TRANSIT_MIN_KT ? nose : nose
      // A contact is a prior, not a deduction: nudge toward it rather than snapping.
      const bearing = circularMean([
        { deg: dir, weight: 0.6 * (inReach[0].c.weight ?? 1) },
        { deg: alongTrack, weight: 0.4 },
      ])
      return {
        bearingDeg: bearing,
        spreadDeg: SPREAD.contact,
        confidence: 'low',
        basis: 'ground-contact',
        note: `A ground contact is ${Math.round(inReach[0].d)} m away, inside the sensor's reach — bearing nudged toward it, not locked to it.`,
      }
    }
  }

  // ── 3. Along-track ──────────────────────────────────────────────────────────────
  if ((groundSpeedKt ?? 0) >= TRANSIT_MIN_KT) {
    // Average the recent course rather than trusting a single heading sample.
    const recent = track.slice(-Math.min(6, track.length))
    const pairs = recent.slice(1).map((p, i) => ({
      deg: bearingDeg(recent[i], p),
      weight: distanceM(recent[i], p) || 1,
    }))
    const along = pairs.length ? circularMean(pairs) : nose
    return {
      bearingDeg: along,
      spreadDeg: SPREAD.alongTrack,
      confidence: 'low',
      basis: 'along-track',
      note: 'In transit and not orbiting: camera assumed ahead. No orbit or contact to infer from.',
    }
  }

  return {
    bearingDeg: nose,
    spreadDeg: SPREAD.nose,
    confidence: 'low',
    basis: 'nose',
    note: 'Slow or stationary without a closed track — nothing to infer a camera direction from.',
  }
}
