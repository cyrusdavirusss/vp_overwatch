// Mock data for VP-Overwatch prototype
// Geographic context: Melbourne, Australia

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
}

export interface TrackPoint {
  t: number
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

const NOW = Date.now()

// Melbourne CBD coordinates
const MELBOURNE_LAT = -37.8136
const MELBOURNE_LNG = 144.9631

function generateTrack(opts: {
  startLat: number
  startLng: number
  heading: number
  speed: number
  alt: number
  minutes: number
  orbit?: { lat: number; lng: number; radius: number }
}): TrackPoint[] {
  const points: TrackPoint[] = []
  const totalSeconds = opts.minutes * 60
  const dt = 4 // 4 second intervals
  const samples = Math.floor(totalSeconds / dt)

  let lat = opts.startLat
  let lng = opts.startLng
  let hdg = opts.heading
  let alt = opts.alt
  let spd = opts.speed
  let theta = 0

  for (let i = 0; i < samples; i++) {
    const t = i * dt

    if (opts.orbit) {
      theta += 0.08
      lat = opts.orbit.lat + Math.cos(theta) * opts.orbit.radius
      lng = opts.orbit.lng + Math.sin(theta) * opts.orbit.radius * 1.3
      hdg = ((theta * 180) / Math.PI + 90) % 360
    } else {
      // Convert speed (knots) to degrees per second (roughly)
      const speedDegPerSec = (spd * 0.0001) / 60
      lat += Math.cos((hdg * Math.PI) / 180) * speedDegPerSec * dt
      lng += Math.sin((hdg * Math.PI) / 180) * speedDegPerSec * dt * 1.3
      hdg = (hdg + Math.sin(i * 0.1) * 2) % 360
    }

    alt += Math.sin(i * 0.3) * 8
    spd += Math.sin(i * 0.5) * 1.2
    const vs = Math.round(Math.sin(i * 0.3) * 200)

    points.push({
      t: -t,
      lat,
      lng,
      alt: Math.round(alt),
      hdg: Math.round(((hdg % 360) + 360) % 360),
      spd: Math.round(spd * 10) / 10,
      vs,
    })
  }

  return points.reverse()
}

export const AIRCRAFT: Aircraft[] = [
  {
    id: '7C7F8C',
    hex: '7C7F8C',
    registration: 'VH-PVH',
    callsign: 'POL61',
    type: 'AW139',
    typeLabel: 'AgustaWestland AW139',
    role: 'rotary',
    operator: 'VicPol Air Wing',
    operatorShort: 'VPAW',
    startTime: NOW - 14 * 60 * 1000,
    timeAirborneSeconds: 14 * 60,
    historicalAverageSeconds: 42 * 60,
    estimatedReturnSeconds: 28 * 60,
    altitude: 1250,
    speed: 78,
    heading: 85,
    latitude: -37.81,
    longitude: 144.96,
    track: generateTrack({
      startLat: -37.82,
      startLng: 144.94,
      heading: 85,
      speed: 78,
      alt: 1250,
      minutes: 14,
    }),
    isActive: true,
    lastSeen: NOW - 14_000,
    fuelEnduranceMinutes: 270,
    fuelRemainingPercent: 95,
  },
  {
    id: '7C2B22',
    hex: '7C2B22',
    registration: 'VH-PVI',
    callsign: 'POL64',
    type: 'EC135',
    typeLabel: 'Eurocopter EC135',
    role: 'rotary',
    operator: 'VicPol Air Wing',
    operatorShort: 'VPAW',
    startTime: NOW - 9 * 60 * 1000,
    timeAirborneSeconds: 9 * 60,
    historicalAverageSeconds: 35 * 60,
    estimatedReturnSeconds: 26 * 60,
    altitude: 900,
    speed: 64,
    heading: 232,
    latitude: -37.79,
    longitude: 145.02,
    track: generateTrack({
      startLat: -37.78,
      startLng: 145.0,
      heading: 232,
      speed: 64,
      alt: 900,
      minutes: 9,
      orbit: { lat: -37.79, lng: 145.01, radius: 0.008 },
    }),
    isActive: true,
    lastSeen: NOW - 9_000,
    fuelEnduranceMinutes: 210,
    fuelRemainingPercent: 97,
  },
  {
    id: '7CF102',
    hex: '7CF102',
    registration: 'VH-AFC',
    callsign: 'AFP21',
    type: 'C208',
    typeLabel: 'Cessna 208 Caravan',
    role: 'fixedwing',
    operator: 'Australian Federal Police',
    operatorShort: 'AFP',
    startTime: NOW - 18 * 60 * 1000,
    timeAirborneSeconds: 18 * 60,
    historicalAverageSeconds: 95 * 60,
    estimatedReturnSeconds: 77 * 60,
    altitude: 2800,
    speed: 112,
    heading: 145,
    latitude: -37.91,
    longitude: 144.83,
    track: generateTrack({
      startLat: -37.85,
      startLng: 144.78,
      heading: 145,
      speed: 112,
      alt: 2800,
      minutes: 18,
    }),
    isActive: true,
    lastSeen: NOW - 18_000,
    fuelEnduranceMinutes: 360,
    fuelRemainingPercent: 97,
  },
  {
    id: '7C1F40',
    hex: '7C1F40',
    registration: 'VH-PVK',
    callsign: 'POL67',
    type: 'AW139',
    typeLabel: 'AgustaWestland AW139',
    role: 'rotary',
    operator: 'VicPol Air Wing',
    operatorShort: 'VPAW',
    startTime: NOW - 6 * 60 * 1000,
    timeAirborneSeconds: 6 * 60,
    historicalAverageSeconds: 38 * 60,
    estimatedReturnSeconds: 32 * 60,
    altitude: 1100,
    speed: 70,
    heading: 312,
    latitude: -37.7,
    longitude: 145.18,
    track: generateTrack({
      startLat: -37.72,
      startLng: 145.15,
      heading: 312,
      speed: 70,
      alt: 1100,
      minutes: 6,
    }),
    isActive: true,
    lastSeen: NOW - 6_000,
    fuelEnduranceMinutes: 270,
    fuelRemainingPercent: 98,
  },
]

function labelForKind(kind: string): string {
  switch (kind) {
    case 'marked':
      return 'Marked unit'
    case 'unmarked':
      return 'Unmarked'
    case 'hidden':
      return 'Hidden unit'
    case 'stop':
      return 'Roadside stop'
    case 'checkpoint':
      return 'Checkpoint'
    case 'rbt':
      return 'RBT'
    case 'camera':
      return 'Camera'
    default:
      return 'Police'
  }
}

export const REPORTS: Report[] = [
  // ── Melbourne Metro ────────────────────────────────────────────────────
  { id: 'r-001', wazeUuid: 'wz-vic-001', type: 'POLICE', subtype: 'POLICE_VISIBLE', kind: 'marked',
    lat: -37.808, lng: 144.978, street: 'Hoddle St', city: 'Abbotsford',
    reliability: 8, confidence: 7, nThumbsUp: 7, reportedAgo: 423, lastConfirmedAgo: 12, descr: 'Marked unit, Hoddle St' },
  { id: 'r-002', wazeUuid: 'wz-vic-002', type: 'POLICE', subtype: 'RBT', kind: 'rbt',
    lat: -37.82, lng: 144.965, street: 'Punt Rd', city: 'Richmond',
    reliability: 9, confidence: 9, nThumbsUp: 14, reportedAgo: 480, lastConfirmedAgo: 22, descr: 'RBT, Punt Rd' },
  // ── Western suburbs / Geelong corridor ─────────────────────────────────
  { id: 'r-003', wazeUuid: 'wz-vic-003', type: 'POLICE', subtype: 'POLICE_HIDDEN', kind: 'hidden',
    lat: -37.89, lng: 144.68, street: 'Princes Fwy', city: 'Werribee',
    reliability: 7, confidence: 7, nThumbsUp: 6, reportedAgo: 310, lastConfirmedAgo: 45, descr: 'Hidden unit, Princes Fwy' },
  { id: 'r-004', wazeUuid: 'wz-vic-004', type: 'POLICE', subtype: 'CHECKPOINT', kind: 'checkpoint',
    lat: -38.15, lng: 144.36, street: 'M1 Princes Fwy', city: 'Geelong',
    reliability: 10, confidence: 9, nThumbsUp: 19, reportedAgo: 600, lastConfirmedAgo: 30, descr: 'Checkpoint, M1 Princes Fwy' },
  // ── Mornington Peninsula / South-east ──────────────────────────────────
  { id: 'r-005', wazeUuid: 'wz-vic-005', type: 'POLICE', subtype: 'ROADSIDE_STOP', kind: 'stop',
    lat: -38.14, lng: 145.12, street: 'Nepean Hwy', city: 'Frankston',
    reliability: 8, confidence: 8, nThumbsUp: 9, reportedAgo: 200, lastConfirmedAgo: 55, descr: 'Roadside stop, Nepean Hwy' },
  { id: 'r-006', wazeUuid: 'wz-vic-006', type: 'POLICE', subtype: 'POLICE_VISIBLE', kind: 'marked',
    lat: -38.35, lng: 145.02, street: 'Moorooduc Hwy', city: 'Mornington',
    reliability: 7, confidence: 6, nThumbsUp: 4, reportedAgo: 900, lastConfirmedAgo: 180, descr: 'Marked unit, Moorooduc Hwy' },
  // ── Eastern suburbs / Dandenong Ranges ─────────────────────────────────
  { id: 'r-007', wazeUuid: 'wz-vic-007', type: 'POLICE', subtype: 'POLICE_HIDDEN', kind: 'hidden',
    lat: -37.76, lng: 145.21, street: 'EastLink', city: 'Ringwood',
    reliability: 8, confidence: 8, nThumbsUp: 8, reportedAgo: 720, lastConfirmedAgo: 120, descr: 'Hidden unit, EastLink' },
  { id: 'r-008', wazeUuid: 'wz-vic-008', type: 'CAMERA', subtype: 'SPEED_CAMERA', kind: 'camera',
    lat: -37.98, lng: 145.35, street: 'Monash Fwy', city: 'Dandenong',
    reliability: 10, confidence: 10, nThumbsUp: 32, reportedAgo: 3600, lastConfirmedAgo: 400, descr: 'Camera, Monash Fwy' },
  // ── Northern suburbs / Hume corridor ───────────────────────────────────
  { id: 'r-009', wazeUuid: 'wz-vic-009', type: 'POLICE', subtype: null, kind: 'unmarked',
    lat: -37.64, lng: 144.93, street: 'Sydney Rd', city: 'Craigieburn',
    reliability: 6, confidence: 6, nThumbsUp: 3, reportedAgo: 240, lastConfirmedAgo: 88, descr: 'Unmarked, Sydney Rd' },
  { id: 'r-010', wazeUuid: 'wz-vic-010', type: 'POLICE', subtype: 'RBT', kind: 'rbt',
    lat: -37.52, lng: 144.95, street: 'Hume Fwy', city: 'Wallan',
    reliability: 9, confidence: 8, nThumbsUp: 11, reportedAgo: 350, lastConfirmedAgo: 40, descr: 'RBT, Hume Fwy' },
  // ── Ballarat / Western Victoria ────────────────────────────────────────
  { id: 'r-011', wazeUuid: 'wz-vic-011', type: 'POLICE', subtype: 'POLICE_VISIBLE', kind: 'marked',
    lat: -37.56, lng: 143.85, street: 'Western Fwy', city: 'Ballarat',
    reliability: 7, confidence: 7, nThumbsUp: 5, reportedAgo: 1200, lastConfirmedAgo: 200, descr: 'Marked unit, Western Fwy' },
  // ── Bendigo / Central Victoria ─────────────────────────────────────────
  { id: 'r-012', wazeUuid: 'wz-vic-012', type: 'POLICE', subtype: 'CHECKPOINT', kind: 'checkpoint',
    lat: -36.76, lng: 144.28, street: 'Calder Fwy', city: 'Bendigo',
    reliability: 9, confidence: 9, nThumbsUp: 16, reportedAgo: 500, lastConfirmedAgo: 60, descr: 'Checkpoint, Calder Fwy' },
  // ── Shepparton / North-east ────────────────────────────────────────────
  { id: 'r-013', wazeUuid: 'wz-vic-013', type: 'POLICE', subtype: 'ROADSIDE_STOP', kind: 'stop',
    lat: -36.38, lng: 145.40, street: 'Goulburn Valley Hwy', city: 'Shepparton',
    reliability: 8, confidence: 7, nThumbsUp: 6, reportedAgo: 800, lastConfirmedAgo: 150, descr: 'Roadside stop, Goulburn Valley Hwy' },
  // ── Gippsland / South-east Victoria ────────────────────────────────────
  { id: 'r-014', wazeUuid: 'wz-vic-014', type: 'POLICE', subtype: 'POLICE_HIDDEN', kind: 'hidden',
    lat: -38.17, lng: 145.93, street: 'Princes Fwy', city: 'Warragul',
    reliability: 7, confidence: 7, nThumbsUp: 5, reportedAgo: 1500, lastConfirmedAgo: 300, descr: 'Hidden unit, Princes Fwy' },
  { id: 'r-015', wazeUuid: 'wz-vic-015', type: 'POLICE', subtype: null, kind: 'unmarked',
    lat: -38.31, lng: 146.43, street: 'Princes Hwy', city: 'Traralgon',
    reliability: 6, confidence: 5, nThumbsUp: 2, reportedAgo: 2400, lastConfirmedAgo: 600, descr: 'Unmarked, Princes Hwy' },
  // ── Great Ocean Road / Surf Coast ──────────────────────────────────────
  { id: 'r-016', wazeUuid: 'wz-vic-016', type: 'POLICE', subtype: 'POLICE_VISIBLE', kind: 'marked',
    lat: -38.33, lng: 144.30, street: 'Great Ocean Rd', city: 'Torquay',
    reliability: 8, confidence: 8, nThumbsUp: 10, reportedAgo: 700, lastConfirmedAgo: 90, descr: 'Marked unit, Great Ocean Rd' },
]

export const USER: User = {
  lat: MELBOURNE_LAT,
  lng: MELBOURNE_LNG,
  hdg: 32,
  accuracy: 25,
}

export const RELAY: Relay = {
  connected: true,
  lastTickAgo: 23,
  pollIntervalSec: 60,
  lastIngested: 87,
  lastRaw: 142,
  coverageRegions: 6,
}

// Helper functions
export function sampleTrack(
  track: TrackPoint[],
  scrubT: number
): TrackPoint | null {
  if (!track || track.length === 0) return null

  // Find the closest point to scrubT seconds ago
  let closest = track[track.length - 1]
  let minDiff = Math.abs(closest.t - -scrubT)

  for (const point of track) {
    const diff = Math.abs(point.t - -scrubT)
    if (diff < minDiff) {
      minDiff = diff
      closest = point
    }
  }

  return closest
}

export function sampleTrailUntil(
  track: TrackPoint[],
  scrubT: number,
  windowSec: number
): TrackPoint[] {
  return track.filter((p) => p.t >= -(scrubT + windowSec) && p.t <= -scrubT)
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
