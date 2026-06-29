// Types and helper functions for VP-Overwatch
// Real data from ADSB.lol and Waze relay — no mock data

export interface Aircraft {
  id: string
  hex: string
  registration: string
  callsign: string
  type: string
  typeLabel: string
  role: 'rotary' | 'fixedwing'
  operator: string
  operatorShort: string
  startTime: number
  timeAirborneSeconds: number
  historicalAverageSeconds: number
  estimatedReturnSeconds: number
  altitude: number
  speed: number
  heading: number
  latitude: number
  longitude: number
  track: TrackPoint[]
  isActive: boolean
  lastSeen: number | null
  fuelEnduranceMinutes: number
  fuelRemainingPercent: number
  /** ADS-B source type from the feed: 'adsb' | 'mlat' | 'mode_s' | 'unknown' */
  source?: 'adsb' | 'mlat' | 'mode_s' | 'unknown'
  /** True when position is MLAT-derived (±300m, altitude unreliable) */
  isMlat?: boolean
  /** True when only Mode-S squitter — detected but no position */
  isModeS?: boolean
  /** 'le' = law-enforcement (known VicPol/AFP hex), 'civil' = everything else in range */
  category?: 'le' | 'civil'
  /** True once judged to have landed (low+slow signal loss, or fuel exhausted).
   *  Distinct from the SILENT state (off-feed but plausibly still airborne). */
  landed?: boolean
}

export interface TrackPoint {
  t: number
  /** Absolute creation time (ms epoch). Reliable timeline for trails/scrub —
   *  unlike `t` (= −timeAirborne), which resets when a sortie's startTime resets. */
  ts?: number
  lat: number
  lng: number
  alt: number
  hdg: number
  spd: number
  vs: number
}

export interface Report {
  id: string
  wazeUuid: string
  type: string
  subtype: string | null
  kind: 'marked' | 'unmarked' | 'hidden' | 'stop' | 'checkpoint' | 'rbt' | 'camera'
  lat: number
  lng: number
  street: string
  city: string
  reliability: number
  confidence: number
  nThumbsUp: number
  reportedAgo: number
  lastConfirmedAgo: number
  descr: string
}

export interface User {
  lat: number
  lng: number
  hdg: number
  accuracy: number
}

export interface Relay {
  connected: boolean
  lastTickAgo: number
  pollIntervalSec: number
  lastIngested: number
  lastRaw: number
  coverageRegions: number
}

// Helper functions
// Position `scrubT` seconds in the past (0 = live/current). Track points are
// stored chronologically (newest last). We sample on the ABSOLUTE `ts` timeline
// where available — `t` (= −timeAirborne) is unreliable: it resets whenever a
// sortie's startTime resets, so it's non-monotonic and can't locate "now".
export function sampleTrack(
  track: TrackPoint[],
  scrubT: number
): TrackPoint | null {
  if (!track || track.length === 0) return null

  // Live view: the newest point IS the current position (array is chronological).
  if (scrubT <= 0) return track[track.length - 1]

  const newest = track[track.length - 1]
  // Prefer the absolute timeline; fall back to legacy `t` for pre-`ts` points.
  if (newest.ts != null) {
    const target = newest.ts - scrubT * 1000
    let closest = newest
    let minDiff = Math.abs(newest.ts - target)
    for (const p of track) {
      if (p.ts == null) continue
      const diff = Math.abs(p.ts - target)
      if (diff < minDiff) { minDiff = diff; closest = p }
    }
    return closest
  }

  let closest = newest
  let minDiff = Math.abs(closest.t - -scrubT)
  for (const point of track) {
    const diff = Math.abs(point.t - -scrubT)
    if (diff < minDiff) { minDiff = diff; closest = point }
  }
  return closest
}

export function sampleTrailUntil(
  track: TrackPoint[],
  scrubT: number,
  windowSec: number
): TrackPoint[] {
  if (!track || track.length === 0) return []

  const newest = track[track.length - 1]
  if (newest.ts != null) {
    // Absolute timeline: keep the last `windowSec` ending at the scrub point.
    const end = newest.ts - scrubT * 1000
    const start = end - windowSec * 1000
    return track.filter((p) => p.ts != null && p.ts >= start && p.ts <= end)
  }

  // Legacy fallback (no ts on any point — only old/restored tracks before the
  // next live append). `t` isn't an absolute timeline, so just return a recent
  // chronological tail (array is oldest→newest). Replaced within seconds once
  // ts-stamped points arrive.
  const approxCount = Math.max(2, Math.round(windowSec / 5))
  return track.slice(-approxCount)
}

export function computeDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function computeBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180)
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLng)
  let brng = (Math.atan2(y, x) * 180) / Math.PI
  return (brng + 360) % 360
}

export function compassFromBearing(deg: number): string {
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ]
  const idx = Math.round(deg / 22.5) % 16
  return dirs[idx]
}

export function formatSec(sec: number): string {
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  if (s < 3600)
    return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, '0')}`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

export function formatHMS(sec: number): string {
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatHM(sec: number): string {
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  return `${m}m`
}

export function clockAt(scrubT: number): string {
  const d = new Date(Date.now() - scrubT * 1000)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}
