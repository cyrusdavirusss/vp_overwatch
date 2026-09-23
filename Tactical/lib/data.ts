// Types and helper functions for VP-Overwatch
// Real data from ADSB.lol and Waze relay — no mock data

export interface Aircraft {
  id: string
  hex: string
  registration: string
  callsign: string
  /** Server-resolved name for display ("King Air POL35"), codename + callsign,
   *  falling back to whichever exists. Absent on older cached payloads. */
  label?: string
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

/**
 * A tracked contact that stopped reporting while still expected to be up: not
 * active, previously seen, and NOT confirmed landed.
 *
 * This single rule drives every amber "lost / silent" signal in the UI — the
 * header's LOST SIGNAL, the map's lost-signal tint, the SILENT counter, the ON
 * AIR chip and the detail panel's lost state. It used to be copy-pasted into
 * each of those sites, and the ON AIR bar's copy omitted the `landed` clause, so
 * a landed airframe kept its amber chip after every other amber signal had
 * cleared. That is the "amber signals are not going off simultaneously" report:
 * they are all supposed to be the SAME condition, so they all call this.
 *
 * (Distinct from the detail panel's MLAT sense of "silent", which means an
 * aircraft reporting position without full ADS-B. Different concept, different
 * colour meaning — do not merge the two.)
 */
export function isSilentContact(
  a: Pick<Aircraft, 'isActive' | 'lastSeen' | 'landed'>
): boolean {
  return a.isActive === false && a.lastSeen != null && a.landed !== true
}

export interface Report {
  id: string
  wazeUuid: string
  type: string
  subtype: string | null
  kind: 'marked' | 'unmarked' | 'hidden' | 'stop' | 'checkpoint' | 'rbt' | 'camera' | 'helicopter'
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
  /** Placement uncertainty in metres, for reports that carry one (helicopter sightings). */
  accuracyM?: number
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
  /** Seconds since the newest GROUND (Waze) alert was ingested. 9999 is the
   *  store's "never ingested" sentinel. Optional so a pre-change payload from a
   *  cached client cannot read as stale. */
  secondsSinceLastIngest?: number
}

/**
 * An hour with no ground ingest means at least one relay tick was missed — the
 * relay polls every 30 min (tools/waze-relay POLL_SECONDS), so the legitimate
 * range between ticks is 0-30 min. Retune this WITH the cadence, or a healthy
 * relay reads as dead (the watchdog's WD_SILENT_LIMIT has the same coupling).
 */
export const GROUND_STALE_AFTER_SEC = 3600

/**
 * Human age of the newest ground ingest.
 *
 * This is the difference between "no data" and "nothing to show": an empty map
 * with a fresh feed means there are genuinely no units to draw, while an empty
 * map with a stale feed means the data stopped arriving. Say "never" for the
 * sentinel rather than printing 9999.
 */
export function formatDataAge(sec: number | undefined): string {
  if (sec === undefined) return '—'
  if (sec >= 9999) return 'never'
  if (sec < 90) return 'now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h}h ${m}m ago` : `${h}h ago`
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

/**
 * Minimum gap between stored breadcrumb points. The fast police loop polls every
 * 3 s, so without a gate a long sortie burns the buffer in minutes.
 */
export const TRAIL_MIN_SPACING_MS = 5_000

/**
 * Cap on stored breadcrumb points per aircraft — a 12 h sortie at 5 s spacing.
 * Sized for the King Air, the longest-endurance airframe in the fleet.
 */
export const TRAIL_MAX_POINTS = 6_000

/**
 * Append a breadcrumb point, keeping the buffer bounded without truncating a
 * sortie.
 *
 * The track must cover a whole flight: the old rule kept 500 raw samples, which
 * at a 3 s poll is ~25 minutes, so a trail disappeared partway through a patrol.
 * Sampling on a minimum spacing instead means a 4 h flight needs ~2,900 points
 * rather than ~4,800, and the cap above then covers even a 12 h sortie.
 *
 * The newest point is always at the true live position: when the next sample is
 * not due yet, the last point SLIDES forward instead of a new one being added,
 * so the trail never lags behind the marker by a whole spacing interval.
 *
 * Returns the SAME array when nothing moved, so callers can keep identity checks
 * cheap and the store does not churn garbage on a stationary aircraft.
 */
export function appendTrackPoint(
  existing: TrackPoint[] | undefined,
  tp: TrackPoint
): TrackPoint[] {
  if (!existing || existing.length === 0) return [tp]

  const last = existing[existing.length - 1]
  if (last.lat === tp.lat && last.lng === tp.lng) return existing // nothing moved

  // Legacy points without `ts` fall back to the movement test alone, so an old
  // track can never wedge the buffer shut.
  const due = last.ts == null || tp.ts == null || tp.ts - last.ts >= TRAIL_MIN_SPACING_MS

  if (!due) {
    // Not due yet: move the newest vertex to the current position so the trail
    // still meets the marker, but KEEP that vertex's timestamps. Refreshing `ts`
    // here would reset the spacing clock on every tick, and since the poll (3 s)
    // runs faster than the spacing, the buffer would then never grow at all —
    // one point, forever. The invariant: only a DUE sample advances the clock.
    const out = existing.slice()
    out[out.length - 1] = {
      ...last, lat: tp.lat, lng: tp.lng, alt: tp.alt, hdg: tp.hdg, spd: tp.spd, vs: tp.vs,
    }
    return out
  }

  if (existing.length >= TRAIL_MAX_POINTS) {
    return [...existing.slice(existing.length - TRAIL_MAX_POINTS + 1), tp]
  }
  return [...existing, tp]
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
