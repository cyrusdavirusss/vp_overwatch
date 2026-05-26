/**
 * In-memory data store for VP-Overwatch
 *
 * Singleton stored on globalThis — survives Next.js hot-reloads so all
 * API routes share the same in-memory state. No database dependency.
 */

// ── Types matching what the frontend expects ──────────────────────────────

export interface TrackPoint {
  t: number
  lat: number
  lng: number
  alt: number
  hdg: number
  spd: number
  vs: number
}

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

// ── Map Kind Helpers ──────────────────────────────────────────────────────

const KIND_MAP: Record<string, Report['kind']> = {
  POLICE_VISIBLE: 'marked',
  POLICE_HIDDEN: 'hidden',
  ROADSIDE_STOP: 'stop',
  CHECKPOINT: 'checkpoint',
  RBT: 'rbt',
  SPEED_CAMERA: 'camera',
  RED_LIGHT_CAMERA: 'camera',
}

function wazeKind(subtype: string | null, type: string): Report['kind'] {
  if (type === 'CAMERA') return 'camera'
  if (subtype && KIND_MAP[subtype]) return KIND_MAP[subtype]
  return 'unmarked'
}

function wazeLabel(kind: Report['kind'], subtype: string | null, street: string): string {
  const labels: Record<Report['kind'], string> = {
    marked: 'Marked unit',
    unmarked: 'Unmarked',
    hidden: 'Hidden unit',
    stop: 'Roadside stop',
    checkpoint: 'Checkpoint',
    rbt: 'RBT',
    camera: 'Camera',
  }
  return `${labels[kind]}, ${street}`
}

// ── Global state (shared across hot-reloads) ─────────────────────────────

interface StoreState {
  aircraftMap: Map<string, Aircraft>
  reportsMap: Map<string, Report>
  userGPS: User
  relay: Relay
  lastOpenSkyPoll: number
}

const GLOBAL_KEY = '__VP_STORE__'

function getState(): StoreState {
  const g = globalThis as any
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      aircraftMap: new Map<string, Aircraft>(),
      reportsMap: new Map<string, Report>(),
      userGPS: { lat: -37.8136, lng: 144.9631, hdg: 0, accuracy: 25 },
      relay: {
        connected: false,
        lastTickAgo: 0,
        pollIntervalSec: 60,
        lastIngested: 0,
        lastRaw: 0,
        coverageRegions: 6,
      },
      lastOpenSkyPoll: 0,
    }
  }
  return g[GLOBAL_KEY]
}

const OPENSKY_POLL_INTERVAL = 60_000

// Melbourne bounding box — slightly generous
const BBOX = { lamin: -38.5, lamax: -36.5, lomin: 144.0, lomax: 146.0 }

// VicPol-known aircraft hex codes
const KNOWN_AIRCRAFT: Record<string, { registration: string; role: Aircraft['role']; operator: string; operatorShort: string; type: string; typeLabel: string }> = {
  '7C7F8C': { registration: 'VH-PVH', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'AW139', typeLabel: 'AgustaWestland AW139' },
  '7C2B22': { registration: 'VH-PVI', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'EC135', typeLabel: 'Eurocopter EC135' },
  '7C1F40': { registration: 'VH-PVK', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'AW139', typeLabel: 'AgustaWestland AW139' },
  '7CF102': { registration: 'VH-AFC', role: 'fixedwing', operator: 'Australian Federal Police', operatorShort: 'AFP', type: 'C208', typeLabel: 'Cessna 208 Caravan' },
}

// ── OpenSky Network Polling ──────────────────────────────────────────────

async function pollOpenSky(): Promise<void> {
  try {
    const url =
      `https://opensky-network.org/api/states/all?` +
      `lamin=${BBOX.lamin}&lamax=${BBOX.lamax}` +
      `&lomin=${BBOX.lomin}&lomax=${BBOX.lomax}`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      console.warn(`[OpenSky] HTTP ${res.status}`)
      return
    }

    const data = await res.json()
    const states: any[] = data?.states ?? []

    const now = Date.now()
    let count = 0
    const s = getState()

    for (const entry of states) {
      const [
        icao24, callsign, _originCountry, _timePosition, _lastContact,
        longitude, latitude, baroAltitude, onGround, velocity,
        trueTrack, verticalRate, _sensors, geoAltitude, _squawk,
        _spi, _positionSource,
      ] = entry

      if (onGround) continue
      if (latitude == null || longitude == null) continue

      const hex = (icao24 as string).toUpperCase()
      const known = KNOWN_AIRCRAFT[hex]

      const alt = Math.round(Number(baroAltitude ?? geoAltitude ?? 0) * 3.28084)
      const speed = Math.round(Number(velocity ?? 0) * 1.94384)
      const heading = Math.round(trueTrack ?? 0)

      const existing = s.aircraftMap.get(hex)
      const startTime = existing?.startTime ?? now
      const timeAirborne = Math.round((now - startTime) / 1000)

      const tp: TrackPoint = {
        t: -timeAirborne,
        lat: latitude,
        lng: longitude,
        alt,
        hdg: heading,
        spd: speed,
        vs: Math.round(Number(verticalRate ?? 0) * 196.85),
      }

      const historicalAvg = known?.role === 'rotary' ? 42 * 60 : 95 * 60

      const aircraft: Aircraft = {
        id: hex,
        hex,
        registration: known?.registration ?? 'N/A',
        callsign: (callsign as string)?.trim() || '',
        type: known?.type ?? 'Unknown',
        typeLabel: known?.typeLabel ?? 'Unknown',
        role: known?.role ?? 'fixedwing',
        operator: known?.operator ?? 'Unknown',
        operatorShort: known?.operatorShort ?? '?',
        startTime,
        timeAirborneSeconds: timeAirborne,
        historicalAverageSeconds: historicalAvg,
        estimatedReturnSeconds: Math.max(0, historicalAvg - timeAirborne),
        altitude: alt,
        speed,
        heading,
        latitude,
        longitude,
        track: existing ? [...existing.track, tp].slice(-500) : [tp],
      }

      s.aircraftMap.set(hex, aircraft)
      count++
    }

    // Prune aircraft not seen in 5 minutes
    const stale = now - 300_000
    for (const [hex, ac] of s.aircraftMap) {
      const lastPos = ac.track[ac.track.length - 1]
      if (!lastPos || (ac.startTime + ac.timeAirborneSeconds * 1000) < stale) {
        s.aircraftMap.delete(hex)
      }
    }

    s.lastOpenSkyPoll = now
    s.relay.lastTickAgo = 0
    console.log(`[OpenSky] ${count} tracked, ${s.aircraftMap.size} active`)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[OpenSky] timeout')
    } else {
      console.warn(`[OpenSky] error: ${err.message}`)
    }
  }
}

// ── Internal relay ticker (only set up once per globalThis lifecycle) ─────

function ensureTicker(): void {
  const g = globalThis as any
  if (g.__VP_TICKER_SET) return
  g.__VP_TICKER_SET = true
  setInterval(() => {
    const s = getState()
    s.relay.lastTickAgo++
    if (s.relay.lastTickAgo > 300) s.relay.connected = false
  }, 1000)
}

ensureTicker()

// ── Public API ──────────────────────────────────────────────────────────

export function getStore() {
  const s = getState()

  return {
    /** Get all current aircraft (triggers OpenSky poll if stale) */
    async getAircraft(): Promise<Aircraft[]> {
      if (Date.now() - s.lastOpenSkyPoll > OPENSKY_POLL_INTERVAL) {
        await pollOpenSky()
      }
      return [...s.aircraftMap.values()]
    },

    /** Get breadcrumb track for a specific hex */
    getBreadcrumbs(hex: string): TrackPoint[] {
      return s.aircraftMap.get(hex)?.track ?? []
    },

    /** Upsert Waze alert from relay */
    upsertAlert(raw: any): void {
      const uuid = raw.uuid
      if (!uuid) return

      const type = raw.type || 'POLICE'
      const subtype = raw.subtype || null
      const kind = wazeKind(subtype, type)
      const now = Date.now()
      const pubMillis = raw.pubMillis ? Number(raw.pubMillis) : now - 60_000
      const reportedAgo = Math.round((now - pubMillis) / 1000)

      const report: Report = {
        id: `wz-${uuid.slice(0, 8)}`,
        wazeUuid: uuid,
        type,
        subtype,
        kind,
        lat: raw.location?.y ?? raw.latitude,
        lng: raw.location?.x ?? raw.longitude,
        street: raw.street || 'Unknown',
        city: raw.city || '',
        reliability: raw.reliability ?? 5,
        confidence: raw.confidence ?? 5,
        nThumbsUp: raw.nThumbsUp ?? 0,
        reportedAgo,
        lastConfirmedAgo: reportedAgo,
        descr: wazeLabel(kind, subtype, raw.street || 'Unknown'),
      }

      s.reportsMap.set(uuid, report)
    },

    /** Delete stale Waze alerts older than 2 hours (7200s) */
    pruneReports(): void {
      for (const [uuid, r] of s.reportsMap) {
        if (r.reportedAgo > 7200) s.reportsMap.delete(uuid)
      }
    },

    /** Get all current Waze reports */
    getReports(): Report[] {
      this.pruneReports()
      return [...s.reportsMap.values()]
    },

    /** Update relay metadata after ingestion */
    updateRelayAfterIngest(count: number, rawCount: number): void {
      s.relay.lastTickAgo = 0
      s.relay.lastIngested = count
      s.relay.lastRaw = rawCount
      s.relay.connected = true
    },

    /** Get relay status */
    getRelay(): Relay {
      return { ...s.relay }
    },

    /** Set user GPS position */
    setGPS(lat: number, lng: number, hdg: number = 0, accuracy: number = 25): void {
      s.userGPS = { lat, lng, hdg, accuracy }
    },

    /** Get user GPS position */
    getGPS(): User {
      return { ...s.userGPS }
    },
  }
}
