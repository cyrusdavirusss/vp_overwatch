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

// ── ADSB.lol Polling ────────────────────────────────────────────────────

async function pollOpenSky(): Promise<void> {
  try {
    const s = getState()
    const { lat, lng } = s.userGPS
    const url =
      `https://api.adsb.lol/v2/point/${lat}/${lng}/100`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      console.warn(`[ADSB.lol] HTTP ${res.status}`)
      // fallback to mock data — don't wipe aircraft map on API fail
      return
    }

    const data = await res.json()
    const aircraft: any[] = data?.ac ?? []

    const now = Date.now()
    let count = 0
    let matched = 0

    // Build a set of seen hexes so we can prune stale ones
    const seenHexes = new Set<string>()

    for (const ac of aircraft) {
      const hex = (ac.hex as string)?.toUpperCase()
      if (!hex) continue
      seenHexes.add(hex)

      const known = KNOWN_AIRCRAFT[hex]
      if (!known) continue

      matched++

      const latitude = ac.lat
      const longitude = ac.lon
      if (latitude == null || longitude == null) continue

      // adsb.lol field mapping
      const alt = Math.round(Number(ac.alt_geom ?? ac.alt_baro ?? 0) * 3.28084)
      const speed = Math.round(Number(ac.gs ?? 0) * 1.94384)
      const heading = Math.round(ac.track ?? 0)
      const verticalRate = ac.baro_rate ?? 0
      const callsign = ac.flight?.trim() || ''

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
        vs: Math.round(Number(verticalRate) * 196.85),
      }

      const historicalAvg = known?.role === 'rotary' ? 42 * 60 : 95 * 60

      const aircraftObj: Aircraft = {
        id: hex,
        hex,
        registration: ac.reg || known?.registration || 'N/A',
        callsign,
        type: ac.type || known?.type || 'Unknown',
        typeLabel: known?.typeLabel || ac.type || 'Unknown',
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

      s.aircraftMap.set(hex, aircraftObj)
      count++
    }

    // Prune aircraft not seen in 5 minutes
    const stale = now - 300_000
    for (const [hex, ac] of s.aircraftMap) {
      if (!seenHexes.has(hex) && (now - ac.startTime - ac.timeAirborneSeconds * 1000) > 300_000) {
        s.aircraftMap.delete(hex)
      }
    }

    s.lastOpenSkyPoll = now
    s.relay.lastTickAgo = 0
    console.log(`[ADSB.lol] ${count} VicPol tracked, ${s.aircraftMap.size} active (${aircraft.length} total in range)`)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[ADSB.lol] timeout')
    } else {
      console.warn(`[ADSB.lol] error: ${err.message}`)
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
