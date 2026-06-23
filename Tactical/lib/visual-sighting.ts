/**
 * visual-sighting.ts — Crowdsourced AR visual sighting system
 *
 * When a user taps an aircraft in AR mode that has no ADS-B position
 * (or whose ADS-B has gone dark), the app captures:
 *   - The user's GPS position
 *   - The compass bearing they were pointing at
 *   - The elevation angle (phone tilt)
 *   - A timestamp
 *
 * This is called a "visual sighting ray."  When two or more users submit
 * rays for the same dark aircraft, the server triangulates an approximate
 * position by finding the closest point between the rays.
 *
 * The result is a "community dot" — a ghost marker on the map visible to
 * all users, with a confidence radius and a projected trajectory arrow.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface VisualSightingRay {
  /** Unique ID for this sighting ray */
  id: string
  /** Hex code of the aircraft (if known from ADS-B history) or a user-assigned label */
  aircraftHex: string
  /** User's GPS position when they made the sighting */
  observerLat: number
  observerLng: number
  /** Compass bearing the user was pointing at (0–360°, 0 = North) */
  bearingDeg: number
  /** Elevation angle above horizon (degrees) */
  elevationDeg: number
  /** Unix timestamp (ms) */
  timestamp: number
  /** User session ID (anonymous, for deduplication) */
  sessionId: string
}

export interface CommunityDot {
  /** Hex code of the aircraft */
  aircraftHex: string
  /** Estimated latitude */
  lat: number
  /** Estimated longitude */
  lng: number
  /** Estimated altitude in feet (from elevation angles) */
  altFt: number
  /** Confidence radius in metres (smaller = more confident) */
  radiusM: number
  /** Number of independent sightings used to compute this position */
  sightingCount: number
  /** Unix timestamp of the most recent sighting */
  lastSeenAt: number
  /** Projected heading in degrees (from successive sightings) */
  projectedHeading: number | null
  /** Projected speed in knots (estimated from successive positions) */
  projectedSpeedKt: number | null
  /** Whether this dot is still "fresh" (within 3 minutes) */
  isFresh: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────

/** How long a community dot stays visible without a new sighting (ms) */
export const DOT_TTL_MS = 3 * 60 * 1000 // 3 minutes

/** Minimum number of independent sightings to show a dot */
export const MIN_SIGHTINGS = 1 // Show immediately, confidence improves with more

/** Maximum age of a sighting ray to include in triangulation (ms) */
export const RAY_MAX_AGE_MS = 90 * 1000 // 90 seconds

// ── Geometry ──────────────────────────────────────────────────────────────

const R_EARTH = 6371000 // metres
const DEG = Math.PI / 180

function toRad(d: number) { return d * DEG }
function toDeg(r: number) { return r / DEG }

/**
 * Project a sighting ray to a point at a given horizontal distance.
 * Returns the lat/lng of the point along the bearing at `distM` metres.
 */
function projectRay(
  lat: number, lng: number,
  bearingDeg: number,
  distM: number,
): { lat: number; lng: number } {
  const d = distM / R_EARTH
  const b = toRad(bearingDeg)
  const lat1 = toRad(lat)
  const lng1 = toRad(lng)

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b)
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  )

  return { lat: toDeg(lat2), lng: toDeg(lng2) }
}

/**
 * Estimate altitude from elevation angle and horizontal distance.
 */
function estimateAltM(elevDeg: number, distM: number): number {
  return Math.tan(toRad(Math.max(0, elevDeg))) * distM
}

/**
 * Closest point between two 3D rays using least-squares.
 * Each ray is defined by an origin (lat/lng/alt) and a direction vector.
 *
 * For simplicity we work in a local flat-earth coordinate system
 * (equirectangular) which is accurate enough for <50km.
 */
function closestPointBetweenRays(
  rays: VisualSightingRay[],
): { lat: number; lng: number; altM: number; radiusM: number } {
  if (rays.length === 0) throw new Error('No rays')

  // Use the centroid of observers as the local origin
  const originLat = rays.reduce((s, r) => s + r.observerLat, 0) / rays.length
  const originLng = rays.reduce((s, r) => s + r.observerLng, 0) / rays.length
  const cosLat = Math.cos(toRad(originLat))

  // Convert each ray to a 3D direction vector in local metres
  type Ray3D = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  const rays3d: Ray3D[] = rays.map(r => {
    // Observer position in local metres
    const ox = (r.observerLng - originLng) * cosLat * R_EARTH * DEG
    const oy = (r.observerLat - originLat) * R_EARTH * DEG
    const oz = 0 // observer is at ground level

    // Direction vector from bearing + elevation
    const b = toRad(r.bearingDeg)
    const e = toRad(r.elevationDeg)
    const cosE = Math.cos(e)
    // In local coords: x=East, y=North, z=Up
    const dx = Math.sin(b) * cosE
    const dy = Math.cos(b) * cosE
    const dz = Math.sin(e)

    return { ox, oy, oz, dx, dy, dz }
  })

  if (rays3d.length === 1) {
    // Single ray — project to a nominal 2km horizontal distance
    const r = rays[0]
    const nomDist = 2000
    const pos = projectRay(r.observerLat, r.observerLng, r.bearingDeg, nomDist)
    const altM = estimateAltM(r.elevationDeg, nomDist)
    return { lat: pos.lat, lng: pos.lng, altM, radiusM: 5000 }
  }

  // Multiple rays — find the weighted centroid of closest-approach points
  // For each pair of rays, find the midpoint of the shortest segment
  const points: { x: number; y: number; z: number }[] = []

  for (let i = 0; i < rays3d.length; i++) {
    for (let j = i + 1; j < rays3d.length; j++) {
      const a = rays3d[i], b = rays3d[j]
      // Solve: a.o + s*a.d and b.o + t*b.d — closest approach
      const w = { x: a.ox - b.ox, y: a.oy - b.oy, z: a.oz - b.oz }
      const dd = a.dx * b.dx + a.dy * b.dy + a.dz * b.dz
      const denom = 1 - dd * dd
      if (Math.abs(denom) < 1e-6) continue // parallel rays

      const s = (-(w.x * a.dx + w.y * a.dy + w.z * a.dz) + dd * (w.x * b.dx + w.y * b.dy + w.z * b.dz)) / denom
      const t = ((w.x * b.dx + w.y * b.dy + w.z * b.dz) - dd * (w.x * a.dx + w.y * a.dy + w.z * a.dz)) / denom

      if (s < 0 || t < 0) continue // behind the observer

      const px = (a.ox + s * a.dx + b.ox + t * b.dx) / 2
      const py = (a.oy + s * a.dy + b.oy + t * b.dy) / 2
      const pz = (a.oz + s * a.dz + b.oz + t * b.dz) / 2
      points.push({ x: px, y: py, z: pz })
    }
  }

  if (points.length === 0) {
    // Fallback: average of single-ray projections
    const positions = rays.map(r => {
      const d = 2000
      const p = projectRay(r.observerLat, r.observerLng, r.bearingDeg, d)
      return { x: (p.lng - originLng) * cosLat * R_EARTH * DEG, y: (p.lat - originLat) * R_EARTH * DEG, z: estimateAltM(r.elevationDeg, d) }
    })
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length
    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length
    const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length
    const lat = originLat + toDeg(cy / R_EARTH)
    const lng = originLng + toDeg(cx / (R_EARTH * cosLat))
    return { lat, lng, altM: cz, radiusM: 4000 }
  }

  // Centroid of all closest-approach midpoints
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const cz = points.reduce((s, p) => s + p.z, 0) / points.length

  // Spread = average distance from centroid (confidence radius)
  const spread = points.reduce((s, p) => {
    return s + Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
  }, 0) / points.length

  const lat = originLat + toDeg(cy / R_EARTH)
  const lng = originLng + toDeg(cx / (R_EARTH * cosLat))
  const radiusM = Math.max(300, Math.min(5000, spread))

  return { lat, lng, altM: cz, radiusM }
}

// ── Trajectory estimation ─────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(a))
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// ── Main export: compute community dot from a set of rays ─────────────────

export function computeCommunityDot(
  aircraftHex: string,
  rays: VisualSightingRay[],
  previousDot: CommunityDot | null,
): CommunityDot | null {
  const now = Date.now()

  // Filter to recent rays only
  const fresh = rays.filter(r => now - r.timestamp < RAY_MAX_AGE_MS)
  if (fresh.length < MIN_SIGHTINGS) return null

  // Deduplicate by session (keep most recent per session)
  const bySession = new Map<string, VisualSightingRay>()
  for (const r of fresh) {
    const existing = bySession.get(r.sessionId)
    if (!existing || r.timestamp > existing.timestamp) {
      bySession.set(r.sessionId, r)
    }
  }
  const uniqueRays = Array.from(bySession.values())

  // Triangulate position
  const { lat, lng, altM, radiusM } = closestPointBetweenRays(uniqueRays)
  const altFt = Math.round(altM * 3.28084)

  // Estimate trajectory from previous dot
  let projectedHeading: number | null = null
  let projectedSpeedKt: number | null = null

  if (previousDot && now - previousDot.lastSeenAt < 60_000) {
    const distM = haversineM(previousDot.lat, previousDot.lng, lat, lng)
    const dtS = (now - previousDot.lastSeenAt) / 1000
    if (distM > 50 && dtS > 0) {
      projectedHeading = bearingDeg(previousDot.lat, previousDot.lng, lat, lng)
      projectedSpeedKt = (distM / dtS) * 1.94384 // m/s to knots
      // Sanity check: helicopters don't do >200kt
      if (projectedSpeedKt > 200) {
        projectedHeading = previousDot.projectedHeading
        projectedSpeedKt = previousDot.projectedSpeedKt
      }
    }
  }

  return {
    aircraftHex,
    lat,
    lng,
    altFt,
    radiusM,
    sightingCount: uniqueRays.length,
    lastSeenAt: Math.max(...uniqueRays.map(r => r.timestamp)),
    projectedHeading,
    projectedSpeedKt,
    isFresh: true,
  }
}
