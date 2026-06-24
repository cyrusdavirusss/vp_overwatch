import https from 'https'
import fs from 'fs'
import path from 'path'

/**
 * Persistent data store for VP-Overwatch
 *
 * Singleton stored on globalThis — survives Next.js hot-reloads so all
 * API routes share the same in-memory state. Periodically snapshots to
 * disk so data (sortie history, aircraft state) survives server restarts.
 * No database dependency.
 */

// ── Disk snapshot path ────────────────────────────────────────────────────
const SNAPSHOT_DIR = path.join(process.env.HOME || '/tmp', '.vp-overwatch')
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'store.json')
const WATCHDOG_PATH = path.join(SNAPSHOT_DIR, 'last-ingest.txt')
let lastSave = 0
const SAVE_THROTTLE_MS = 5_000
const LAST_INGEST_TS_PATH = WATCHDOG_PATH

/**
 * Throttled save of essential state to disk so data survives restarts.
 * Saves: sortieHistory, relay state, aircraft startTime/isActive (for
 * sortie continuity), and reports (Waze alerts).
 */
function saveToDisk(): void {
  const now = Date.now()
  if (now - lastSave < SAVE_THROTTLE_MS) return
  lastSave = now
  const s = getState()
  const snapshot = {
    ts: now,
    sortieHistory: s.sortieHistory,
    relay: { lastIngested: s.relay.lastIngested, lastRaw: s.relay.lastRaw },
    aircraftState: [...s.aircraftMap.entries()].map(([hex, ac]) => ({
      hex, startTime: ac.startTime, isActive: ac.isActive,
      callsign: ac.callsign, latitude: ac.latitude, longitude: ac.longitude,
      altitude: ac.altitude, heading: ac.heading, speed: ac.speed,
      lastSeen: ac.lastSeen, track: ac.track.slice(-100),
    })),
    reports: [...s.reportsMap.entries()].map(([uuid, r]) => ({ uuid, ...r })),
    subscribers: s.notifState.subscribers.map(sub => ({ ...sub })),
  }
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot), 'utf-8')
  } catch (e: any) {
    console.error('[store] save failed:', e.message)
  }
}

/**
 * Load disk snapshot into a fresh store. Called once on module init.
 * Restores sortie history, aircraft continuity, and unexpired reports.
 */
function loadFromDisk(): void {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf-8')
    const snap = JSON.parse(raw)
    const s = getState()
    const now = Date.now()

    // Restore sortie history
    if (Array.isArray(snap.sortieHistory)) {
      s.sortieHistory = snap.sortieHistory
      console.log(`[store] loaded ${s.sortieHistory.length} sortie entries`)
    }

    // Restore aircraft state (startTime, tracks) so polling doesn't reset
    if (Array.isArray(snap.aircraftState)) {
      let restored = 0
      for (const ac of snap.aircraftState) {
        const existing = s.aircraftMap.get(ac.hex)
        if (existing) {
          existing.startTime = ac.startTime || existing.startTime
          existing.callsign = ac.callsign || existing.callsign
          existing.track = (ac.track || []).slice(-500)
          // Mark as last-seen so we don't immediately create a new sortie
          existing.lastSeen = now
          restored++
        }
      }
      console.log(`[store] restored ${restored} aircraft states`)
    }

    // Restore relay ingest counters
    if (snap.relay) {
      s.relay.lastIngested = snap.relay.lastIngested ?? 0
      s.relay.lastRaw = snap.relay.lastRaw ?? 0
    }

    // Restore reports that aren't stale yet
    if (Array.isArray(snap.reports)) {
      let restored = 0
      for (const r of snap.reports) {
        if (r.uuid && r.reportedAgo != null && r.reportedAgo < 7200) {
          // Normalise legacy ids: older snapshots used an 8-char uuid slice,
          // which collided when uuids shared a prefix (e.g. alert-12*) and
          // produced duplicate React keys. Re-derive from the full uuid.
          r.id = `wz-${r.uuid}`
          s.reportsMap.set(r.uuid, r)
          restored++
        }
      }
      console.log(`[store] restored ${restored} reports`)
    }

    // Restore subscribers
    if (Array.isArray(snap.subscribers)) {
      s.notifState.subscribers = snap.subscribers.map((sub: any) => ({
        ...sub,
        notifyOn: sub.notifyOn ?? { takeoff: true, stealth: true, land: true },
        // Fail closed: any legacy row without an explicit consent record is
        // treated as NOT consented and won't be dialed until re-confirmed.
        consent: sub.consent ?? { granted: false, grantedAt: null, method: null },
      }))
      console.log(`[store] restored ${s.notifState.subscribers.length} subscribers`)
    }
  } catch (e: any) {
    console.error('[store] load failed:', e.message)
  }
}

/**
 * Write a watchdog timestamp so external monitors (cron) can detect when
 * the Waze scraper has stopped sending data.
 */
function touchWatchdog(): void {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    fs.writeFileSync(WATCHDOG_PATH, String(Date.now()), 'utf-8')
  } catch { /* best-effort */ }
}

/**
 * Returns seconds since the last ingest watchdog write. NaN if never written.
 */
function secondsSinceLastIngest(): number {
  try {
    const raw = fs.readFileSync(WATCHDOG_PATH, 'utf-8').trim()
    const ts = parseInt(raw, 10)
    return isNaN(ts) ? NaN : Math.round((Date.now() - ts) / 1000)
  } catch { return NaN }
}

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

/** Live position pushed by the browser client every ~10s. */
export interface UserLocation {
  lat: number
  lng: number
  accuracy: number
  heading: number
  updatedAt: number
}

export interface Relay {
  connected: boolean
  lastTickAgo: number
  pollIntervalSec: number
  lastIngested: number
  lastRaw: number
  coverageRegions: number
}

export interface SortieEntry {
  id: string
  hex: string
  callsign: string
  type: string
  operatorShort: string
  startTime: number
  endTime: number | null
  durationSeconds: number
  maxAltitude: number
  status: 'active' | 'landed'
}

// ── Notification system ────────────────────────────────────────────────────
import { createNotifState, notifyTakeoff, notifyLand, notifyStealth, resetHexNotifications, addSubscriber, removeSubscriber, updateSubscriber, type Subscriber, type NotificationEvent, type AircraftBrief } from '@/lib/notifications'

/** Project a full Aircraft record down to the telemetry Hermes briefs on. */
function aircraftToBrief(ac: Aircraft): AircraftBrief {
  return {
    registration: ac.registration,
    callsign: ac.callsign,
    typeLabel: ac.typeLabel,
    altitude: ac.altitude,
    speed: ac.speed,
    heading: ac.heading,
    fuelEnduranceMinutes: ac.fuelEnduranceMinutes,
    fuelRemainingPercent: ac.fuelRemainingPercent,
    timeAirborneSeconds: ac.timeAirborneSeconds,
  }
}

// ── Map Kind Helpers ──────────────────────────────────────────────────────

const KIND_MAP: Record<string, Report['kind']> = {
  POLICE_VISIBLE: 'marked',
  POLICE_HIDDEN: 'hidden',
  POLICE_WITH_MOBILE_CAMERA: 'camera',
  MOBILE_CAMERA: 'camera',
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
  userLocation: UserLocation | null
  relay: Relay
  lastOpenSkyPoll: number
  sortieHistory: SortieEntry[]
  sortieMaxAlt: Map<string, number>
  notifState: ReturnType<typeof createNotifState>
}

const GLOBAL_KEY = '__VP_STORE__'

function getState(): StoreState {
  const g = globalThis as any
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      aircraftMap: new Map<string, Aircraft>(),
      reportsMap: new Map<string, Report>(),
      userGPS: { lat: -37.8136, lng: 144.9631, hdg: 0, accuracy: 25 },
      userLocation: null,
      relay: {
        connected: false,
        lastTickAgo: 0,
        pollIntervalSec: 60,
        lastIngested: 0,
        lastRaw: 0,
        coverageRegions: 6,
      },
      lastOpenSkyPoll: 0,
      sortieHistory: [],
      sortieMaxAlt: new Map(),
      notifState: createNotifState(),
    }
  }
  return g[GLOBAL_KEY]
}

const OPENSKY_POLL_INTERVAL = 60_000

// Melbourne bounding box — slightly generous
const BBOX = { lamin: -38.5, lamax: -36.5, lomin: 144.0, lomax: 146.0 }

// VicPol-known aircraft hex codes
const KNOWN_AIRCRAFT: Record<string, { registration: string; role: Aircraft['role']; operator: string; operatorShort: string; type: string; typeLabel: string; fuelEnduranceMinutes: number }> = {
  '7C7F8C': { registration: 'VH-PVH', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'AW139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 270 },
  '7C2B22': { registration: 'VH-PVI', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'EC135', typeLabel: 'Eurocopter EC135', fuelEnduranceMinutes: 210 },
  '7C1F40': { registration: 'VH-PVK', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'AW139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 270 },
  '7C4EF2': { registration: 'VH-PVO', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 270 },
  '7C4EF4': { registration: 'VH-PVQ', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 270 },
  '7C4EF5': { registration: 'VH-PVR', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 270 },
  '7C4EE8': { registration: 'VH-PVE', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 270 },
  '7CF102': { registration: 'VH-AFC', role: 'fixedwing', operator: 'Australian Federal Police', operatorShort: 'AFP', type: 'C208', typeLabel: 'Cessna 208 Caravan', fuelEnduranceMinutes: 360 },
}

// ── VicPol police aircraft polled on a dedicated fast (3s) loop ───────────
// These 4 hexes are queried directly by ICAO hex (batch) every 3 seconds so
// active police helicopters update near-real-time, independent of the slower
// area-wide ADS-B poll. Merged results are forced to role "rotary" /
// operator "Victoria Police".
const POLICE_HEXES = ['7C4EF2', '7C4EF4', '7C4EF5', '7C4EE8']
const POLICE_CALLSIGNS: Record<string, string> = {
  '7C4EF2': 'POL30',
  '7C4EF4': 'POL31',
  '7C4EF5': 'POL32',
  '7C4EE8': 'POL35',
}
const FAST_POLICE_INTERVAL = 3_000

// ── Pre-populate known airframes on startup ─────────────────────────────
// Silent (not seen on ADSB) aircraft stay in the map with isActive=false —
// frontend renders them as amber.
function initKnownAircraft(): void {
  const s = getState()
  for (const [hex, info] of Object.entries(KNOWN_AIRCRAFT)) {
    if (!s.aircraftMap.has(hex)) {
      s.aircraftMap.set(hex, {
        id: hex,
        hex,
        registration: info.registration,
        callsign: '',
        type: info.type,
        typeLabel: info.typeLabel,
        role: info.role,
        operator: info.operator,
        operatorShort: info.operatorShort,
        startTime: 0,
        timeAirborneSeconds: 0,
        historicalAverageSeconds: info.role === 'rotary' ? 42 * 60 : 95 * 60,
        estimatedReturnSeconds: info.role === 'rotary' ? 42 * 60 : 95 * 60,
        altitude: 0,
        speed: 0,
        heading: 0,
        latitude: 0,
        longitude: 0,
        track: [],
        isActive: false,
        lastSeen: null,
        fuelEnduranceMinutes: info.fuelEnduranceMinutes,
        fuelRemainingPercent: 100,
      })
    }
  }
}
initKnownAircraft()
loadFromDisk()

/**
 * Compute rolling average flight duration from completed sorties.
 * Uses the last 10 landed sorties for this hex. Falls back to the
 * hardcoded role default if no sortie history exists yet.
 */
function computeHistoricalAverage(hex: string, roleDefault: number): number {
  const s = getState()
  const completed = s.sortieHistory
    .filter((e) => e.hex === hex && e.status === 'landed' && e.durationSeconds > 60)
    .slice(-10)
  if (completed.length === 0) return roleDefault
  return Math.round(
    completed.reduce((sum, e) => sum + e.durationSeconds, 0) / completed.length
  )
}

// ── ADSB.lol Polling ────────────────────────────────────────────────────

function fetchJsonHttps(url: string, timeout: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('Invalid JSON')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

async function pollOpenSky(): Promise<void> {
  try {
    const s = getState()
    const { lat, lng } = s.userGPS
    const url =
      `https://api.adsb.lol/v2/point/${lat}/${lng}/100`

    const data = await fetchJsonHttps(url, 15_000)
    const aircraft: any[] = data?.ac ?? []

    const now = Date.now()
    let count = 0
    let matched = 0

    // Capture previous active states for sortie transition tracking
    const prevActiveStates = new Map<string, boolean>()
    for (const [hex, ac] of s.aircraftMap) {
      if (KNOWN_AIRCRAFT[hex]) {
        prevActiveStates.set(hex, ac.isActive)
      }
    }

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

      // adsb.lol field mapping — alt_geom is often 0 for MLAT, fallback to alt_baro
      const altRaw = (ac.alt_geom != null && Number(ac.alt_geom) > 0) ? Number(ac.alt_geom) : (ac.alt_baro != null ? Number(ac.alt_baro) : 0)
      const alt = Math.round(altRaw * 3.28084)
      const speed = Math.round(Number(ac.gs ?? 0) * 1.94384)
      const heading = Math.round(ac.track ?? 0)
      const verticalRate = ac.baro_rate ?? ac.geom_rate ?? 0
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

      const historicalAvg = computeHistoricalAverage(hex, known?.role === 'rotary' ? 42 * 60 : 95 * 60)

      const fuelEndurance = known?.fuelEnduranceMinutes ?? 270
      const fuelPct = Math.max(0, Math.min(100, Math.round((1 - timeAirborne / (fuelEndurance * 60)) * 100)))

      const aircraftObj: Aircraft = {
        id: hex,
        hex,
        registration: ac.r || known?.registration || 'N/A',
        callsign,
        type: ac.t || known?.type || 'Unknown',
        typeLabel: known?.typeLabel || ac.t || 'Unknown',
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
        isActive: true,
        lastSeen: now,
        fuelEnduranceMinutes: fuelEndurance,
        fuelRemainingPercent: fuelPct,
        source: ac.type === 'mlat' ? 'mlat' : ac.type === 'adsb' ? 'adsb' : ac.type === 'mode_s' ? 'mode_s' : 'unknown',
        isMlat: ac.type === 'mlat',
        isModeS: ac.type === 'mode_s',
      }

      s.aircraftMap.set(hex, aircraftObj)

      // Detect sortie start: was inactive, now active
      const wasActiveHex = prevActiveStates.get(hex)
      if (wasActiveHex === false) {
        // Reset startTime to now so fuel calculates from this sortie, not first-seen
        const sortieStartTime = now
        const entry: SortieEntry = {
          id: `sortie-${hex}-${now}`,
          hex,
          callsign,
          type: known?.type || ac.t || 'Unknown',
          operatorShort: known?.operatorShort ?? '?',
          startTime: sortieStartTime,
          endTime: null,
          durationSeconds: 0,
          maxAltitude: alt,
          status: 'active',
        }
        s.sortieHistory.push(entry)
        s.sortieMaxAlt.set(hex, alt)
        // Reset aircraft startTime so fuel timer starts from this sortie
        if (existing) existing.startTime = sortieStartTime
        saveToDisk()
      } else if (wasActiveHex === true) {
        // Update max altitude for ongoing sortie
        const currentMax = s.sortieMaxAlt.get(hex) ?? 0
        if (alt > currentMax) {
          s.sortieMaxAlt.set(hex, alt)
        }
      }

      count++
    }

    // Prune only NON-known hexes — known aircraft stay forever (silent = amber)
    for (const [hex, ac] of s.aircraftMap) {
      if (!KNOWN_AIRCRAFT[hex] && (now - ac.startTime - ac.timeAirborneSeconds * 1000) > 300_000) {
        s.aircraftMap.delete(hex)
      }
    }

    // Mark known aircraft not seen in this poll as inactive and record sortie end
    for (const [hex, ac] of s.aircraftMap) {
      if (KNOWN_AIRCRAFT[hex] && !seenHexes.has(hex)) {
        const wasActiveHex = prevActiveStates.get(hex)
        if (wasActiveHex === true) {
          ac.isActive = false
          // Find active sortie entry and close it
          const activeIdx = s.sortieHistory.findIndex(e => e.hex === hex && e.status === 'active')
          if (activeIdx !== -1) {
            const entry = s.sortieHistory[activeIdx]
            entry.endTime = now
            entry.durationSeconds = Math.round((now - entry.startTime) / 1000)
            entry.maxAltitude = s.sortieMaxAlt.get(hex) ?? ac.altitude
            entry.status = 'landed'
            saveToDisk()
          }
        }
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

// ── Fast police loop (every 3s, batch hex query) ─────────────────────────

// Try the ADSB.lol hex endpoints in order until one returns a usable payload.
// Different deployments expose v3 (adsb.lol) or v2 (api.adsb.lol); we accept
// whichever responds with an { ac: [...] } shape.
async function fetchPoliceAdsb(): Promise<any[]> {
  const hexes = POLICE_HEXES.map((h) => h.toLowerCase()).join(',')
  const candidates = [
    `https://adsb.lol/v3/ac/hex/${hexes}`,
    `https://api.adsb.lol/v2/icao/${hexes}`,
    `https://api.adsb.lol/v2/hex/${hexes}`,
  ]
  for (const url of candidates) {
    try {
      const data = await fetchJsonHttps(url, 5_000)
      if (Array.isArray(data?.ac)) return data.ac
    } catch {
      // try next candidate
    }
  }
  return []
}

async function pollFastPolice(): Promise<void> {
  try {
    const s = getState()
    const aircraft = await fetchPoliceAdsb()
    const now = Date.now()

    // Capture previous active states for sortie transition tracking
    const prevActiveStates = new Map<string, boolean>()
    for (const hex of POLICE_HEXES) {
      const ac = s.aircraftMap.get(hex)
      prevActiveStates.set(hex, ac ? ac.isActive : false)
    }

    for (const ac of aircraft) {
      const hex = (ac.hex as string)?.toUpperCase()
      if (!hex || !POLICE_HEXES.includes(hex)) continue

      const latitude = ac.lat
      const longitude = ac.lon
      if (latitude == null || longitude == null) continue

      const altRaw = (ac.alt_geom != null && Number(ac.alt_geom) > 0)
        ? Number(ac.alt_geom)
        : (ac.alt_baro != null ? Number(ac.alt_baro) : 0)
      const alt = Math.round(altRaw * 3.28084)
      const speed = Math.round(Number(ac.gs ?? 0) * 1.94384)
      const heading = Math.round(ac.track ?? 0)
      const verticalRate = ac.baro_rate ?? ac.geom_rate ?? 0
      const callsign = ac.flight?.trim() || POLICE_CALLSIGNS[hex] || ''

      const known = KNOWN_AIRCRAFT[hex]
      const existing = s.aircraftMap.get(hex)
      const startTime = (existing && existing.startTime > 0) ? existing.startTime : now
      const timeAirborne = Math.round((now - startTime) / 1000)

      // Detect sortie start: was inactive, now active → reset fuel timer
      let justTookOff = false
      const wasActiveHex = prevActiveStates.get(hex)
      if (wasActiveHex === false) {
        // Reset startTime to now so fuel is calculated from this sortie, not first-seen
        const sortieStartTime = now
        const entry: SortieEntry = {
          id: `sortie-${hex}-${now}`,
          hex,
          callsign,
          type: known?.type || ac.t || 'A139',
          operatorShort: known?.operatorShort ?? 'VICPOL',
          startTime: sortieStartTime,
          endTime: null,
          durationSeconds: 0,
          maxAltitude: alt,
          status: 'active',
        }
        s.sortieHistory.push(entry)
        s.sortieMaxAlt.set(hex, alt)
        // Write back into existing so subsequent track points use the reset startTime
        if (existing) existing.startTime = sortieStartTime
        saveToDisk()
        // Defer the takeoff notification until the full aircraft record below is
        // built, so Hermes can brief on complete telemetry (speed/heading/fuel).
        justTookOff = true
      } else if (wasActiveHex === true) {
        // Update max altitude for ongoing sortie
        const currentMax = s.sortieMaxAlt.get(hex) ?? 0
        if (alt > currentMax) s.sortieMaxAlt.set(hex, alt)
      }

      // Re-read startTime (may have been reset by sortie start above)
      const effectiveStartTime = (existing?.startTime ?? startTime)
      const effectiveTimeAirborne = Math.round((now - effectiveStartTime) / 1000)

      const tp: TrackPoint = {
        t: -effectiveTimeAirborne,
        lat: latitude,
        lng: longitude,
        alt,
        hdg: heading,
        spd: speed,
        vs: Math.round(Number(verticalRate) * 196.85),
      }

      const fuelEndurance = known?.fuelEnduranceMinutes ?? 270
      const fuelPct = Math.max(0, Math.min(100, Math.round((1 - effectiveTimeAirborne / (fuelEndurance * 60)) * 100)))
      const historicalAvg = computeHistoricalAverage(hex, 42 * 60)

      // Avoid duplicating breadcrumb points when nothing moved between ticks.
      const last = existing?.track[existing.track.length - 1]
      const moved = !last || last.lat !== latitude || last.lng !== longitude
      const track = existing
        ? (moved ? [...existing.track, tp].slice(-500) : existing.track)
        : [tp]

      s.aircraftMap.set(hex, {
        id: hex,
        hex,
        registration: ac.r || known?.registration || 'N/A',
        callsign,
        type: ac.t || known?.type || 'A139',
        typeLabel: known?.typeLabel || ac.t || 'AgustaWestland AW139',
        role: 'rotary',
        operator: 'Victoria Police',
        operatorShort: 'VICPOL',
        startTime: effectiveStartTime,
        timeAirborneSeconds: effectiveTimeAirborne,
        historicalAverageSeconds: historicalAvg,
        estimatedReturnSeconds: Math.max(0, historicalAvg - effectiveTimeAirborne),
        altitude: alt,
        speed,
        heading,
        latitude,
        longitude,
        track,
        isActive: true,
        lastSeen: now,
        fuelEnduranceMinutes: fuelEndurance,
        fuelRemainingPercent: fuelPct,
        source: ac.type === 'mlat' ? 'mlat' : ac.type === 'adsb' ? 'adsb' : ac.type === 'mode_s' ? 'mode_s' : 'unknown',
        isMlat: ac.type === 'mlat',
        isModeS: ac.type === 'mode_s',
      })

      // Now that the full record exists, fire the takeoff briefing (async, don't
      // block the poll loop). Hermes briefs from complete telemetry.
      if (justTookOff) {
        const acNow = s.aircraftMap.get(hex)
        notifyTakeoff(s.notifState, hex, callsign, alt, acNow ? aircraftToBrief(acNow) : undefined).catch(e =>
          console.warn('[notif] takeoff error:', e?.message)
        )
      }
    }

    // Mark police hexes not seen in this poll as inactive and close sorties
    for (const hex of POLICE_HEXES) {
      const acEntry = s.aircraftMap.get(hex)
      const wasActiveHex = prevActiveStates.get(hex)
      if (acEntry && wasActiveHex === true && !aircraft.some((a) => (a.hex as string)?.toUpperCase() === hex)) {
        acEntry.isActive = false
        const activeIdx = s.sortieHistory.findIndex(e => e.hex === hex && e.status === 'active')
        if (activeIdx !== -1) {
          const entry = s.sortieHistory[activeIdx]
          entry.endTime = now
          entry.durationSeconds = Math.round((now - entry.startTime) / 1000)
          entry.maxAltitude = s.sortieMaxAlt.get(hex) ?? acEntry.altitude
          entry.status = 'landed'
          saveToDisk()
          // Fire land notification (async, don't block poll loop)
          const duration = Math.round((now - entry.startTime) / 1000)
          notifyLand(s.notifState, hex, acEntry.callsign || POLICE_CALLSIGNS[hex] || '', duration, aircraftToBrief(acEntry)).catch(e =>
            console.warn('[notif] land error:', e?.message)
          )
        }
      }
    }
  } catch (err: any) {
    console.warn(`[ADSB.lol fast-police] error: ${err.message}`)
  }
}

function ensureFastPoliceLoop(): void {
  const g = globalThis as any
  if (g.__VP_FAST_POLICE_SET) return
  g.__VP_FAST_POLICE_SET = true
  // Kick off immediately, then poll the 4 police hexes every 3 seconds.
  pollFastPolice()
  setInterval(() => { pollFastPolice() }, FAST_POLICE_INTERVAL)
}

ensureFastPoliceLoop()

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

  // Periodic disk snapshot (every 30s) — catches any state we didn't save inline
  setInterval(() => { saveToDisk() }, 30_000)
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
      return [...s.aircraftMap.values()].filter(
        (a) => a.latitude !== 0 || a.longitude !== 0 || a.callsign !== ''
      )
    },

    /** Get breadcrumb track for a specific hex */
    getBreadcrumbs(hex: string): TrackPoint[] {
      return s.aircraftMap.get(hex)?.track ?? []
    },

    /** Get sortie history (newest first) */
    getSortieHistory(): SortieEntry[] {
      return [...s.sortieHistory].reverse()
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
        id: `wz-${uuid}`,
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
      saveToDisk()
      touchWatchdog()
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

    /** Get relay status (includes watchdog seconds-since-last-ingest) */
    getRelay(): Relay & { secondsSinceLastIngest: number } {
      return { ...s.relay, secondsSinceLastIngest: secondsSinceLastIngest() || 9999 }
    },

    /** Set user GPS position */
    setGPS(lat: number, lng: number, hdg: number = 0, accuracy: number = 25): void {
      s.userGPS = { lat, lng, hdg, accuracy }
    },

    /** Get user GPS position */
    getGPS(): User {
      return { ...s.userGPS }
    },

    /**
     * Store the live browser-reported position (pushed every ~10s). Also
     * updates userGPS so the area-wide ADS-B poll re-centres on the user.
     */
    setUserLocation(lat: number, lng: number, accuracy: number = 25, heading: number = 0): void {
      s.userLocation = { lat, lng, accuracy, heading, updatedAt: Date.now() }
      s.userGPS = { lat, lng, hdg: heading, accuracy }
    },

    /** Get the most recent live browser position (null if never reported). */
    getUserLocation(): UserLocation | null {
      return s.userLocation ? { ...s.userLocation } : null
    },

    // ── Notification subscriber management ──────────────────────────────────

    addSubscriber(name: string, phone: string, notifyOn?: Subscriber['notifyOn']): Subscriber {
      const sub = addSubscriber(s.notifState, name, phone, notifyOn)
      saveToDisk()
      return sub
    },

    removeSubscriber(id: string): boolean {
      return removeSubscriber(s.notifState, id)
    },

    updateSubscriber(id: string, updates: Partial<Subscriber>): Subscriber | null {
      return updateSubscriber(s.notifState, id, updates)
    },

    getSubscribers(): Subscriber[] {
      return [...s.notifState.subscribers]
    },

    getNotificationEvents(limit: number = 20, since?: number): NotificationEvent[] {
      let events = s.notifState.eventLog
      if (since) events = events.filter(e => e.timestamp > since)
      return events.slice(-limit).reverse()
    },

    resetHexNotifications(hex: string): void {
      resetHexNotifications(s.notifState, hex)
    },
  }
}
