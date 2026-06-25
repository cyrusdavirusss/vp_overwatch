/**
 * Ground community reports ("VPS").
 * ─────────────────────────────────────────────────────────────────────────
 * A user drops a pin at their location for a police unit / camera. Pins of the
 * same kind within CONFIRM_RADIUS_M cluster together. A cluster confirmed by
 * >= CONFIRM_COUNT *distinct* reporters is promoted to a single LIVE marker at
 * the centroid of its reports — and that centroid refines (the marker moves)
 * as more reports come in. Reports older than REPORT_TTL_MS expire.
 */

export type GroundKind = 'marked' | 'unmarked' | 'hidden'

export interface PendingGroundReport {
  id: string
  kind: GroundKind
  lat: number
  lng: number
  createdAt: number
  sessionId: string
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
}

export const CONFIRM_RADIUS_M = 50
export const CONFIRM_COUNT = 3
export const REPORT_TTL_MS = 30 * 60 * 1000 // 30 minutes

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
  const fresh = pending.filter((r) => now - r.createdAt < REPORT_TTL_MS)
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
    if (sessions.size < CONFIRM_COUNT) continue
    out.push({
      id: `cr-${c.kind}-${c.members[0].id}`,
      kind: c.kind,
      lat: c.lat,
      lng: c.lng,
      confirmed: true,
      reportCount: sessions.size,
      createdAt: Math.min(...c.members.map((m) => m.createdAt)),
      lastReportAt: Math.max(...c.members.map((m) => m.createdAt)),
    })
  }
  return out
}
