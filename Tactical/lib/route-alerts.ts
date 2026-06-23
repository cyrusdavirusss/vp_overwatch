/**
 * route-alerts.ts — Route proximity alerting for VP-Overwatch
 *
 * The core "fusion" feature: given the user's current route (a series of
 * lat/lng waypoints), determine which police aircraft and ground units are
 * within a configurable corridor around that route and rank them by threat.
 *
 * This is the thing that turns raw data into the sentence:
 *   "POL31 is orbiting 2km northeast and there is a confirmed hidden unit
 *    on your route."
 */

import type { Aircraft, Report } from './store'

// ── Geometry helpers ──────────────────────────────────────────────────────

const R = 6371000 // Earth radius in metres

function toRad(deg: number) { return (deg * Math.PI) / 180 }

/** Haversine distance in metres between two lat/lng points. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Minimum perpendicular distance (in metres) from point P to the
 * line segment A→B.  Returns the distance and the closest point on
 * the segment.
 */
function pointToSegmentM(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): { distM: number; closestLat: number; closestLng: number } {
  // Project onto flat plane using equirectangular approximation (fine for <50km)
  const cosLat = Math.cos(toRad((aLat + bLat) / 2))
  const ax = aLng * cosLat, ay = aLat
  const bx = bLng * cosLat, by = bLat
  const px = pLng * cosLat, py = pLat

  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy

  let t = 0
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  }

  const closestX = ax + t * dx
  const closestY = ay + t * dy
  const closestLat = closestY
  const closestLng = closestX / cosLat

  const distM = haversineM(pLat, pLng, closestLat, closestLng)
  return { distM, closestLat, closestLng }
}

/**
 * Minimum distance (in metres) from a point to any segment of a polyline.
 */
export function distanceToRouteM(
  pLat: number, pLng: number,
  route: Array<{ lat: number; lng: number }>,
): { distM: number; segmentIndex: number; closestLat: number; closestLng: number } {
  let best = { distM: Infinity, segmentIndex: 0, closestLat: pLat, closestLng: pLng }
  for (let i = 0; i < route.length - 1; i++) {
    const { distM, closestLat, closestLng } = pointToSegmentM(
      pLat, pLng,
      route[i].lat, route[i].lng,
      route[i + 1].lat, route[i + 1].lng,
    )
    if (distM < best.distM) {
      best = { distM, segmentIndex: i, closestLat, closestLng }
    }
  }
  return best
}

// ── Threat classification ─────────────────────────────────────────────────

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low'

function classifyAircraftThreat(distM: number, aircraft: Aircraft): ThreatLevel {
  // Orbiting aircraft directly overhead the route is critical
  if (distM < 500) return 'critical'
  if (distM < 1500) return 'high'
  if (distM < 4000) return 'medium'
  return 'low'
}

function classifyGroundThreat(distM: number, report: Report): ThreatLevel {
  if (distM < 200) return 'critical'   // On your route
  if (distM < 500) return 'high'       // Just off route
  if (distM < 1500) return 'medium'
  return 'low'
}

// ── Public types ──────────────────────────────────────────────────────────

export interface AircraftAlert {
  kind: 'aircraft'
  aircraft: Aircraft
  distM: number
  distKm: string
  bearing: number
  compassDir: string
  threat: ThreatLevel
  closestLat: number
  closestLng: number
  segmentIndex: number
  /** Human-readable summary for the "one sentence" UI */
  summary: string
}

export interface GroundAlert {
  kind: 'ground'
  report: Report
  distM: number
  distKm: string
  bearing: number
  compassDir: string
  threat: ThreatLevel
  closestLat: number
  closestLng: number
  segmentIndex: number
  summary: string
}

export type RouteAlert = AircraftAlert | GroundAlert

export interface RouteAlertResult {
  alerts: RouteAlert[]
  /** The single most important sentence to show the user */
  headline: string | null
  hasCritical: boolean
  hasHigh: boolean
}

// ── Bearing helpers ───────────────────────────────────────────────────────

function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const dLng = toRad(toLng - fromLng)
  const lat1 = toRad(fromLat), lat2 = toRad(toLat)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function compassDir(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8]
}

// ── Main analysis function ────────────────────────────────────────────────

/**
 * Analyse all aircraft and ground units against the user's current route.
 *
 * @param userLat       Current user latitude
 * @param userLng       Current user longitude
 * @param route         Ordered array of route waypoints (from navigation)
 * @param aircraft      All active aircraft from the store
 * @param reports       All active ground reports from the store
 * @param corridorM     Half-width of the route corridor in metres (default 2000m = 2km)
 */
export function analyseRoute(
  userLat: number,
  userLng: number,
  route: Array<{ lat: number; lng: number }>,
  aircraft: Aircraft[],
  reports: Report[],
  corridorM = 2000,
): RouteAlertResult {
  const alerts: RouteAlert[] = []

  // ── Aircraft alerts ──────────────────────────────────────────────────────
  for (const ac of aircraft) {
    if (!ac.isActive || ac.latitude === 0) continue

    const { distM, closestLat, closestLng, segmentIndex } = route.length >= 2
      ? distanceToRouteM(ac.latitude, ac.longitude, route)
      : { distM: haversineM(ac.latitude, ac.longitude, userLat, userLng), segmentIndex: 0, closestLat: userLat, closestLng: userLng }

    if (distM > corridorM * 3) continue // Way outside corridor, skip

    const threat = classifyAircraftThreat(distM, ac)
    const bear = bearingDeg(userLat, userLng, ac.latitude, ac.longitude)
    const dir = compassDir(bear)
    const distKm = (distM / 1000).toFixed(1)

    const orbitHint = ac.role === 'rotary' ? 'orbiting' : 'operating'
    const summary = `${ac.callsign || ac.registration} is ${orbitHint} ${distKm}km ${dir} of your route`

    alerts.push({
      kind: 'aircraft', aircraft: ac, distM, distKm, bearing: bear,
      compassDir: dir, threat, closestLat, closestLng, segmentIndex, summary,
    })
  }

  // ── Ground unit alerts ───────────────────────────────────────────────────
  for (const report of reports) {
    const { distM, closestLat, closestLng, segmentIndex } = route.length >= 2
      ? distanceToRouteM(report.lat, report.lng, route)
      : { distM: haversineM(report.lat, report.lng, userLat, userLng), segmentIndex: 0, closestLat: userLat, closestLng: userLng }

    if (distM > corridorM) continue // Only show units actually in the corridor

    const threat = classifyGroundThreat(distM, report)
    const bear = bearingDeg(userLat, userLng, report.lat, report.lng)
    const dir = compassDir(bear)
    const distKm = (distM / 1000).toFixed(1)

    const unitLabel = report.kind === 'hidden' ? 'hidden unit' :
      report.kind === 'marked' ? 'marked unit' :
      report.kind === 'rbt' ? 'RBT' :
      report.kind === 'camera' ? 'speed camera' : 'unit'

    const onRoute = distM < 300 ? 'on your route' : `${distKm}km ${dir} of your route`
    const summary = `Confirmed ${unitLabel} ${onRoute}${report.street ? ` on ${report.street}` : ''}`

    alerts.push({
      kind: 'ground', report, distM, distKm, bearing: bear,
      compassDir: dir, threat, closestLat, closestLng, segmentIndex, summary,
    })
  }

  // Sort by threat severity then distance
  const threatOrder: Record<ThreatLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  alerts.sort((a, b) => {
    const tDiff = threatOrder[a.threat] - threatOrder[b.threat]
    return tDiff !== 0 ? tDiff : a.distM - b.distM
  })

  const hasCritical = alerts.some(a => a.threat === 'critical')
  const hasHigh = alerts.some(a => a.threat === 'high')

  // Build the "one sentence" headline
  let headline: string | null = null
  if (alerts.length > 0) {
    const topAircraft = alerts.find(a => a.kind === 'aircraft') as AircraftAlert | undefined
    const topGround = alerts.find(a => a.kind === 'ground') as GroundAlert | undefined

    if (topAircraft && topGround) {
      headline = `${topAircraft.aircraft.callsign || topAircraft.aircraft.registration} is orbiting ${topAircraft.distKm}km ${topAircraft.compassDir} and there is a confirmed ${topGround.report.kind === 'hidden' ? 'hidden unit' : 'unit'} on your route`
    } else if (topAircraft) {
      headline = topAircraft.summary
    } else if (topGround) {
      headline = topGround.summary
    }
  }

  return { alerts, headline, hasCritical, hasHigh }
}
