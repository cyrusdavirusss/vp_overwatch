/**
 * Ground community reports ("VPS").
 * ─────────────────────────────────────────────────────────────────────────
 * A user drops a pin at their location for a police unit / camera. Pins of the
 * same kind within CONFIRM_RADIUS_M cluster together. A cluster confirmed by
 * >= CONFIRM_COUNT *distinct* reporters is promoted to a single LIVE marker at
 * the centroid of its reports — and that centroid refines (the marker moves)
 * as more reports come in. Reports older than REPORT_TTL_MS expire.
 */

export type GroundKind = 'marked' | 'unmarked' | 'hidden' | 'helicopter'

export interface PendingGroundReport {
  id: string
  kind: GroundKind
  lat: number
  lng: number
  createdAt: number
  sessionId: string
  /**
   * A PRIVILEGED broadcast: published on its own authority, with no need for other
   * people to corroborate it. See computeCommunityReports for why that exception
   * exists at all.
   */
  authoritative?: boolean
  /**
   * How coarse the placement was, in metres. A sighting dropped on a half-state view
   * is honest about being approximate; carrying the number means the map can say so
   * instead of implying a precise position.
   */
  accuracyM?: number
}

export interface CommunityReportItem {
  id: string
  kind: GroundKind
  lat: number
  lng: number
  confirmed: boolean
  reportCount: number // distinct reporters
  createdAt: number
  lastReportAt: number
  /** Published on a single privileged report, not on corroboration. */
  authoritative: boolean
  accuracyM?: number
}

export const CONFIRM_RADIUS_M = 50
export const CONFIRM_COUNT = 3
/**
 * How long a police sighting is worth showing, counted from when it was PUBLISHED
 * (Waze) or created (community report) — NOT from the last poll that re-served it.
 * A unit reported 40 minutes ago has almost certainly moved on.
 */
export const POLICE_MAX_AGE_MS = 40 * 60 * 1000

/**
 * Cameras get longer, because they do not move: a speed/red-light/mobile camera
 * reported 90 minutes ago is very often still sitting on that stretch of road.
 */
export const CAMERA_MAX_AGE_MS = 90 * 60 * 1000

/** Police lifetime — the community-report pool and the legacy restore window. */
export const REPORT_TTL_MS = POLICE_MAX_AGE_MS

/**
 * A helicopter gets a SHORTER window than a ground unit, because it is the one report
 * that moves fast. A parked unit reported 40 minutes ago is probably still within a
 * street or two; a helicopter in transit does 130-150 kt, so 40 minutes is ~160 km —
 * a quarter of the state. Fifteen minutes is still ~60 km of possible drift, which is
 * why the sighting carries its own accuracy and why "approximately" is the honest word.
 */
export const HELICOPTER_TTL_MS = 15 * 60 * 1000

/** Per-kind freshness window. Everything except a helicopter uses the police window. */
export function ttlForKind(kind: GroundKind): number {
  return kind === 'helicopter' ? HELICOPTER_TTL_MS : REPORT_TTL_MS
}

const R = 6371000
const toRad = (d: number) => (d * Math.PI) / 180

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

interface Cluster {
  kind: GroundKind
  members: PendingGroundReport[]
  lat: number
  lng: number
}

/**
 * Cluster fresh pending reports and return render items:
 *  - confirmed clusters (>= 3 distinct reporters within 50 m) → one live marker
 *    at the centroid (refines as reports arrive)
 *  - unconfirmed clusters → each member shown as its own pending pin
 */
export function computeCommunityReports(
  pending: PendingGroundReport[],
  now: number = Date.now()
): CommunityReportItem[] {
  const fresh = pending.filter((r) => now - r.createdAt < ttlForKind(r.kind))
  const clusters: Cluster[] = []

  for (const r of fresh) {
    let c = clusters.find(
      (cl) => cl.kind === r.kind && haversineM(cl.lat, cl.lng, r.lat, r.lng) <= CONFIRM_RADIUS_M
    )
    if (!c) {
      c = { kind: r.kind, members: [], lat: r.lat, lng: r.lng }
      clusters.push(c)
    }
    c.members.push(r)
    // Refine centroid = mean of all member positions (the "triangulation").
    c.lat = c.members.reduce((s, m) => s + m.lat, 0) / c.members.length
    c.lng = c.members.reduce((s, m) => s + m.lng, 0) / c.members.length
  }

  const out: CommunityReportItem[] = []
  for (const c of clusters) {
    // A report is a HIDDEN pin until >= CONFIRM_COUNT distinct people confirm
    // it within CONFIRM_RADIUS_M. Unconfirmed clusters are not published.
    const sessions = new Set(c.members.map((m) => m.sessionId))
    const authoritative = c.members.some((m) => m.authoritative)

    // The corroboration rule exists because an anonymous pin is a claim about someone
    // else's position, and one such claim should not put a unit on everyone's map.
    //
    // A privileged broadcast is the one case where that rule is wrong. It reports
    // something that may not be on the map AT ALL: an aircraft that has gone dark has
    // no ADS-B, so a person on the ground is the only sensor there is. Waiting for
    // three strangers to independently confirm it would mean the one real sighting
    // that exists never gets published. So it is published on its own authority —
    // which is exactly why the submitter has to authenticate.
    if (!authoritative && sessions.size < CONFIRM_COUNT) continue

    const accuracies = c.members.map((m) => m.accuracyM ?? 0)
    out.push({
      id: `cr-${c.kind}-${c.members[0].id}`,
      kind: c.kind,
      lat: c.lat,
      lng: c.lng,
      confirmed: true,
      reportCount: sessions.size,
      createdAt: Math.min(...c.members.map((m) => m.createdAt)),
      lastReportAt: Math.max(...c.members.map((m) => m.createdAt)),
      authoritative,
      accuracyM: Math.max(...accuracies) || undefined,
    })
  }
  return out
}
