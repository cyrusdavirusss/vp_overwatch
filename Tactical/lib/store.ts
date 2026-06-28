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
// Bound the sortie log so heap, snapshot size, and per-landing/per-request scans stay flat.
const MAX_SORTIE_HISTORY = 1000
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
      // Persist the fuel timer so a restart/deploy doesn't snap a mid-flight
      // tank back to 100% (which would also reset the silent-expiry window).
      fuelRemainingPercent: ac.fuelRemainingPercent, landed: ac.landed,
      timeAirborneSeconds: ac.timeAirborneSeconds,
    })),
    reports: [...s.reportsMap.entries()].map(([uuid, r]) => ({ uuid, ...r })),
    subscribers: s.notifState.subscribers.map(sub => ({ ...sub })),
    groundReports: s.groundReports,
  }
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    // Async write so a growing snapshot never blocks the event loop on the hot path.
    fs.promises
      .writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot), 'utf-8')
      .catch((e: any) => console.error('[store] async save failed:', e?.message))
  } catch (e: any) {
    console.error('[store] save failed:', e.message)
  }
}

/** Append a sortie and keep only the most recent MAX_SORTIE_HISTORY entries. */
function pushSortie(s: StoreState, entry: SortieEntry): void {
  s.sortieHistory.push(entry)
  if (s.sortieHistory.length > MAX_SORTIE_HISTORY) {
    s.sortieHistory.splice(0, s.sortieHistory.length - MAX_SORTIE_HISTORY)
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
      s.sortieHistory = snap.sortieHistory.slice(-MAX_SORTIE_HISTORY)
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
          // Continue the fuel timer from where it was rather than the seeded 100%,
          // so a live contact's tank (and its silent-expiry bound) survives a
          // restart. isActive/position are deliberately NOT restored — the next
          // poll re-confirms them, so a restart never resurrects a stale phantom.
          if (typeof ac.fuelRemainingPercent === 'number') existing.fuelRemainingPercent = ac.fuelRemainingPercent
          if (typeof ac.timeAirborneSeconds === 'number') existing.timeAirborneSeconds = ac.timeAirborneSeconds
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
      const now = Date.now()
      for (const r of snap.reports) {
        const lastSeen = r.lastSeenAt ?? r.pubMillis ?? (r.reportedAgo != null ? now - r.reportedAgo * 1000 : 0)
        if (r.uuid && now - lastSeen < REPORT_TTL_MS) {
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

    // Restore pending ground (VPS) reports that haven't expired
    if (Array.isArray(snap.groundReports)) {
      const cutoff = Date.now()
      s.groundReports = snap.groundReports.filter((r: any) => r && r.createdAt && cutoff - r.createdAt < REPORT_TTL_MS)
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
  /** 'le' = law-enforcement (known VicPol/AFP hex), 'civil' = everything else in range */
  category?: 'le' | 'civil'
  /** True once judged to have landed (low+slow signal loss, or fuel exhausted). */
  landed?: boolean
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
import { computeCommunityReports, haversineM, REPORT_TTL_MS, type PendingGroundReport, type GroundKind } from '@/lib/community-reports'
import {
  perfForHex,
  trueAirspeedKt,
  instantFuelFlowKgH,
  maxRemainingEnduranceSec,
} from '@/lib/fuel-model'
import { currentAreaWind, refreshAreaWind } from '@/lib/wind'

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
  /** Transient civil aircraft in range (AR sky view only — not the 2D map/safety bar) */
  civilMap: Map<string, Aircraft>
  reportsMap: Map<string, Report>
  userGPS: User
  userLocation: UserLocation | null
  relay: Relay
  lastOpenSkyPoll: number
  sortieHistory: SortieEntry[]
  sortieMaxAlt: Map<string, number>
  notifState: ReturnType<typeof createNotifState>
  groundReports: PendingGroundReport[]
}

const GLOBAL_KEY = '__VP_STORE__'

function getState(): StoreState {
  const g = globalThis as any
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      aircraftMap: new Map<string, Aircraft>(),
      civilMap: new Map<string, Aircraft>(),
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
      groundReports: [],
    }
  }
  return g[GLOBAL_KEY]
}

const OPENSKY_POLL_INTERVAL = 60_000

// Melbourne bounding box — slightly generous
const BBOX = { lamin: -38.5, lamax: -36.5, lomin: 144.0, lomax: 146.0 }

// VicPol-known aircraft hex codes
const KNOWN_AIRCRAFT: Record<string, { registration: string; role: Aircraft['role']; operator: string; operatorShort: string; type: string; typeLabel: string; fuelEnduranceMinutes: number }> = {
  // fuelEnduranceMinutes = best-endurance max, derived in lib/fuel-model.ts from
  // usable fuel / minimum fuel flow (AW139 ~274, EC135 ~210, C208 ~374). Used as
  // a fallback; the live figure comes from the physics fuel model per poll.
  '7C7F8C': { registration: 'VH-PVH', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'AW139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 274 },
  '7C2B22': { registration: 'VH-PVI', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'EC135', typeLabel: 'Eurocopter EC135', fuelEnduranceMinutes: 210 },
  '7C1F40': { registration: 'VH-PVK', role: 'rotary', operator: 'VicPol Air Wing', operatorShort: 'VPAW', type: 'AW139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 274 },
  '7C4EF2': { registration: 'VH-PVO', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 274 },
  '7C4EF4': { registration: 'VH-PVQ', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 274 },
  '7C4EF5': { registration: 'VH-PVR', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 274 },
  '7C4EE8': { registration: 'VH-PVE', role: 'rotary', operator: 'Victoria Police', operatorShort: 'VICPOL', type: 'A139', typeLabel: 'AgustaWestland AW139', fuelEnduranceMinutes: 274 },
  '7CF102': { registration: 'VH-AFC', role: 'fixedwing', operator: 'Australian Federal Police', operatorShort: 'AFP', type: 'C208', typeLabel: 'Cessna 208 Caravan', fuelEnduranceMinutes: 374 },
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
        category: 'le',
      })
    }
  }
}
initKnownAircraft()
loadFromDisk()

// A known airframe that goes "silent" (off-ADS-B, isActive=false) can only
// still be airborne until it runs out of fuel. We therefore hold the amber
// SILENT flag for exactly as long as the aircraft could plausibly still be up,
// then clear it (it must be on the ground). The window is computed per-airframe
// from real telemetry, not a flat timer:
//   • aircraft TYPE/CLASS: per-tail perf profile (PERF_BY_HEX in fuel-model.ts)
//     sets usable fuel + min fuel flow, so plane vs heli vs heli-type differ.
//   • FUEL ACTUALLY BURNED: the physics model (airspeed, altitude, climb,
//     acceleration, wind, weight) integrates burn per poll into
//     fuelRemainingPercent; silentExpiryMs converts the fuel left when it went
//     dark into the longest it could still fly (maxRemainingEnduranceSec).
//     A chopper that went dark after 4 h of hard low orbit clears in ~30 min;
//     one that went dark 5 min after takeoff stays flagged for hours.
//
// SILENT_RESERVE_MS extends the window slightly past dry-tank endurance so a
// momentary ADS-B dropout right at the fuel limit doesn't clear a contact that
// is actually still flying. SILENT_MIN_GRACE_MS is a floor so a brief blip
// never clears a freshly-airborne contact.
const SILENT_RESERVE_MS = 5 * 60_000
const SILENT_MIN_GRACE_MS = 3 * 60_000

// ── Fast-police signal-loss / landing lifecycle ─────────────────────────────
// Police MLAT coverage is intermittent, so a contact routinely drops off the
// feed for a few seconds while still flying. Hold it through brief dropouts
// before judging it gone — otherwise it flaps on/off, resets the fuel timer, and
// fires spurious land alerts (the bug behind "shows SILENT but it's still up" and
// the frozen fuel bar). Only PAST this gap do we decide landed vs silent.
const POLICE_SILENT_DEBOUNCE_MS = 30_000
// Terminal-state landing heuristic at debounce expiry: low + slow ≈ on/near the
// ground. MSL altitude is all the feed gives; Melbourne airfields sit ~280–430ft.
const LANDED_ALT_FT = 500
const LANDED_SPD_KT = 30
// Keep a just-landed contact on the map (flagged LANDED) this long before it
// goes dormant, so you can see where it put down.
const LANDED_LINGER_MS = 2 * 60_000

// Per-hex fuel-integration clock (advances every poll, whether the contact was
// seen or is silent) and the moment it was flagged landed. Module-level &
// transient — rebuilt from telemetry after a restart, so they never bloat the
// persisted Aircraft record.
const policeFuelCalcAt = new Map<string, number>()
const policeLandedAt = new Map<string, number>()

// Integrate a police contact's fuel % forward to `now` from its fuel clock,
// using the supplied telemetry (live when seen, last-known held when silent —
// vsFpm 0 in that case). Drains while airborne AND while off-feed; floors at 0.
function integratePoliceFuelPct(
  hex: string,
  prevPct: number,
  now: number,
  altFt: number,
  gsKt: number,
  trackDeg: number,
  vsFpm: number,
  fallbackEnduranceMin: number,
  timeAirborneSec: number,
): number {
  const perf = perfForHex(hex)
  const last = policeFuelCalcAt.get(hex) ?? now
  policeFuelCalcAt.set(hex, now)
  if (!perf) {
    return Math.max(0, Math.min(100, (1 - timeAirborneSec / (fallbackEnduranceMin * 60)) * 100))
  }
  const dtH = (now - last) / 3.6e6
  if (dtH <= 0 || dtH > 0.5) return prevPct // first tick or a long gap: hold
  try {
    const wind = currentAreaWind()
    const tas = trueAirspeedKt(gsKt, trackDeg, wind)
    const weightFrac = Math.max(0, Math.min(1, prevPct / 100))
    const ff = instantFuelFlowKgH(perf, tas, altFt, vsFpm, 0, weightFrac)
    const prevKg = (prevPct / 100) * perf.usableFuelKg
    const newKg = Math.max(0, prevKg - ff * dtH)
    // Keep FULL PRECISION — a single 3s/60s tick burns a fraction of a percent;
    // rounding to an int here would round every tick straight back to the prior
    // value, so the tank would never actually drain. Round only for display.
    return Math.max(0, Math.min(100, (newKg / perf.usableFuelKg) * 100))
  } catch {
    return prevPct
  }
}

// Flag a fast-police contact as LANDED: stop it counting as airborne/silent,
// close its open sortie, and brief the landing once. Keeps its last position so
// the map can show where it put down (retired to dormant after LANDED_LINGER_MS).
function markLandedPolice(ac: Aircraft, now: number): void {
  const s = getState()
  ac.isActive = false
  ac.landed = true
  policeLandedAt.set(ac.hex, now)
  const idx = s.sortieHistory.findIndex((e) => e.hex === ac.hex && e.status === 'active')
  if (idx !== -1) {
    const entry = s.sortieHistory[idx]
    entry.endTime = now
    entry.durationSeconds = Math.round((now - entry.startTime) / 1000)
    entry.maxAltitude = s.sortieMaxAlt.get(ac.hex) ?? ac.altitude
    entry.status = 'landed'
    notifyLand(s.notifState, ac.hex, ac.callsign || POLICE_CALLSIGNS[ac.hex] || '', entry.durationSeconds, aircraftToBrief(ac)).catch((e) =>
      console.warn('[notif] land error:', e?.message)
    )
  }
  saveToDisk()
}

// Reset a known airframe back to its dormant pre-seed state: keeps the slot
// (registration / type / operator) ready for the next sortie, but clears the
// last position + lastSeen so it drops off the map and out of the SILENT count.
function resetToDormant(ac: Aircraft): void {
  ac.isActive = false
  ac.lastSeen = null
  ac.startTime = 0
  ac.timeAirborneSeconds = 0
  ac.callsign = ''
  ac.latitude = 0
  ac.longitude = 0
  ac.altitude = 0
  ac.speed = 0
  ac.heading = 0
  ac.track = []
  ac.fuelRemainingPercent = 100
  ac.landed = false
  policeFuelCalcAt.delete(ac.hex)
  policeLandedAt.delete(ac.hex)
}

const KT_TO_MS = 0.514444

// Model-based remaining fuel %, integrated incrementally each poll using real
// wall-clock dt (the stored track's relative `t` is unreliable). Accounts for
// true airspeed (wind-corrected), altitude/air density, climb/descent,
// longitudinal acceleration and falling weight as fuel burns. Falls back to the
// linear time model when no perf profile exists or telemetry is missing.
function modelFuelPercent(
  hex: string,
  prev: Aircraft | undefined,
  now: number,
  altFt: number,
  gsKt: number,
  trackDeg: number,
  vsFpm: number,
  timeAirborneSec: number,
  fallbackEnduranceMin: number,
): number {
  const perf = perfForHex(hex)
  const linear = Math.max(0, Math.min(100, (1 - timeAirborneSec / (fallbackEnduranceMin * 60)) * 100))
  if (!perf || !prev || !prev.lastSeen || !prev.isActive) return linear
  const dtH = (now - prev.lastSeen) / 3.6e6
  if (dtH <= 0 || dtH > 0.5) return prev.fuelRemainingPercent ?? linear // gap >30min: hold last
  try {
    const wind = currentAreaWind()
    const tasNow = trueAirspeedKt(gsKt, trackDeg, wind)
    const tasPrev = trueAirspeedKt(prev.speed, prev.heading, wind)
    const accel = ((tasNow - tasPrev) * KT_TO_MS) / (dtH * 3600)
    const weightFrac = Math.max(0, Math.min(1, (prev.fuelRemainingPercent ?? 100) / 100))
    const ff = instantFuelFlowKgH(perf, tasNow, altFt, vsFpm, accel, weightFrac)
    const prevKg = ((prev.fuelRemainingPercent ?? 100) / 100) * perf.usableFuelKg
    const newKg = Math.max(0, prevKg - ff * dtH)
    // Full precision (see integratePoliceFuelPct) — rounding per tick would stall
    // the drain. Display layers round for presentation.
    return Math.max(0, Math.min(100, (newKg / perf.usableFuelKg) * 100))
  } catch {
    return linear
  }
}

// Wall-clock time by which a silent airframe must have landed: the moment it
// went dark + however long its REMAINING fuel could keep it aloft (computed by
// the physics model from how hard it was actually flown), + reserve. Falls back
// to type endurance from takeoff if no perf profile / fuel state is available.
function silentExpiryMs(ac: Aircraft): number {
  const perf = perfForHex(ac.hex)
  const base = ac.lastSeen ?? (ac.startTime || Date.now())
  if (perf && ac.fuelRemainingPercent != null) {
    const remKg = (ac.fuelRemainingPercent / 100) * perf.usableFuelKg
    return base + maxRemainingEnduranceSec(remKg, perf) * 1000 + SILENT_RESERVE_MS
  }
  const enduranceMs = (ac.fuelEnduranceMinutes || 60) * 60_000
  const takeoff = ac.startTime && ac.startTime > 0 ? ac.startTime : base
  return takeoff + enduranceMs + SILENT_RESERVE_MS
}

// Clear any known airframe that has been silent long enough that its fuel must
// be exhausted — it took off and has since landed (or gone permanently dark).
function pruneSilentKnown(now: number): void {
  const s = getState()
  for (const hex of Object.keys(KNOWN_AIRCRAFT)) {
    const ac = s.aircraftMap.get(hex)
    if (!ac || ac.isActive || ac.lastSeen == null) continue
    // Fast-police hexes have their own debounce/landing/fuel-drain lifecycle in
    // pollFastPolice (incl. the LANDED linger) — don't double-retire them here.
    if (POLICE_HEXES.includes(hex) || ac.landed) continue
    const silentForMs = now - ac.lastSeen
    // Retire once the tank is dry (fuel drains every 3s while silent, below) or
    // it has been dark past its fuel-based endurance bound — whichever first.
    const dry = (ac.fuelRemainingPercent ?? 0) <= 0
    if (silentForMs >= SILENT_MIN_GRACE_MS && (dry || now >= silentExpiryMs(ac))) {
      resetToDormant(ac)
    }
  }
}

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

/**
 * Reject coordinates that ADS-B feeds emit as noise: null/NaN, the (0,0) null
 * island, or anything outside the valid lat/lng envelope. ~15% of the police
 * feed arrives as (0,0); letting those through corrupts the breadcrumb track
 * and flings the camera to the Gulf of Guinea.
 */
function validLatLng(lat: any, lng: any): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
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
    // Refresh winds aloft for the operating area (cached, fire-and-forget) so
    // the fuel model can correct groundspeed → true airspeed.
    refreshAreaWind(lat, lng)
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
      if (!known) {
        // Civil aircraft in range — a lightweight transient record kept only for
        // the AR "sky" view (NOT the 2D map or the law-enforcement safety bar).
        const clat = ac.lat
        const clng = ac.lon
        if (!validLatLng(clat, clng)) continue
        const calt = (ac.alt_geom != null && Number(ac.alt_geom) > 0)
          ? Number(ac.alt_geom)
          : (ac.alt_baro != null ? Number(ac.alt_baro) : 0)
        s.civilMap.set(hex, {
          id: hex,
          hex,
          registration: ac.r || 'N/A',
          callsign: ac.flight?.trim() || '',
          type: ac.t || 'Unknown',
          typeLabel: ac.desc || ac.t || 'Unknown',
          role: 'fixedwing',
          operator: ac.ownOp || 'Civil',
          operatorShort: 'CIV',
          startTime: 0,
          timeAirborneSeconds: 0,
          historicalAverageSeconds: 0,
          estimatedReturnSeconds: 0,
          altitude: Math.round(calt),
          speed: Math.round(Number(ac.gs ?? 0)),
          heading: Math.round(Number(ac.track ?? 0)),
          latitude: clat,
          longitude: clng,
          track: [],
          isActive: true,
          lastSeen: now,
          fuelEnduranceMinutes: 0,
          fuelRemainingPercent: 0,
          source: ac.type === 'mlat' ? 'mlat' : ac.type === 'adsb' ? 'adsb' : ac.type === 'mode_s' ? 'mode_s' : 'unknown',
          isMlat: ac.type === 'mlat',
          isModeS: ac.type === 'mode_s',
          category: 'civil',
        })
        continue
      }

      matched++

      // Police hexes are owned exclusively by pollFastPolice (3s loop). Letting
      // this 60s loop also write them produced an interleaved two-source track
      // (zigzag) and clobbered the fast loop's fuel/startTime every minute.
      if (POLICE_HEXES.includes(hex)) continue

      const latitude = ac.lat
      const longitude = ac.lon
      if (!validLatLng(latitude, longitude)) continue

      // adsb.lol field mapping — alt_geom is often 0 for MLAT, fallback to alt_baro
      // ADSB.lol returns alt_geom/alt_baro in FEET and gs in KNOTS — do NOT convert
      const altRaw = (ac.alt_geom != null && Number(ac.alt_geom) > 0) ? Number(ac.alt_geom) : (ac.alt_baro != null ? Number(ac.alt_baro) : 0)
      const alt = Math.round(altRaw)   // already feet
      const speed = Math.round(Number(ac.gs ?? 0))   // already knots
      const heading = Math.round(ac.track ?? 0)
      const verticalRate = ac.baro_rate ?? ac.geom_rate ?? 0
      const callsign = ac.flight?.trim() || ''

      const existing = s.aircraftMap.get(hex)
      const wasActiveHex = prevActiveStates.get(hex)

      // Sortie start = was inactive, now seen active. On takeoff (or whenever the
      // stored startTime is the seeded-0 sentinel) anchor the fuel/airborne timer
      // to *now*, so fuel burns from this sortie rather than the first-ever sighting.
      const justTookOff = wasActiveHex === false
      const effectiveStartTime =
        justTookOff || !existing || existing.startTime <= 0 ? now : existing.startTime
      const timeAirborne = Math.round((now - effectiveStartTime) / 1000)

      const tp: TrackPoint = {
        t: -timeAirborne,
        lat: latitude,
        lng: longitude,
        alt,
        hdg: heading,
        spd: speed,
        vs: Math.round(Number(verticalRate)), // ADSB.lol baro_rate/geom_rate already in fpm
      }

      const historicalAvg = computeHistoricalAverage(hex, known.role === 'rotary' ? 42 * 60 : 95 * 60)

      const fuelEndurance = known.fuelEnduranceMinutes ?? 270
      // Burn fuel only once genuinely airborne (a real start time in the past).
      // Full tank on takeoff; thereafter integrate the physics fuel model.
      const airborne = effectiveStartTime > 0 && effectiveStartTime !== now
      const fuelPct = !airborne || justTookOff
        ? 100
        : modelFuelPercent(hex, existing, now, alt, speed, heading, Math.round(Number(verticalRate)), timeAirborne, fuelEndurance)

      // Append a breadcrumb only when the position actually changed — kills the
      // stationary jitter the no-dedup append used to produce.
      const lastTp = existing?.track[existing.track.length - 1]
      const moved = !lastTp || lastTp.lat !== latitude || lastTp.lng !== longitude
      const track = existing ? (moved ? [...existing.track, tp].slice(-500) : existing.track) : [tp]

      const aircraftObj: Aircraft = {
        id: hex,
        hex,
        registration: ac.r || known.registration || 'N/A',
        callsign,
        type: ac.t || known.type || 'Unknown',
        typeLabel: known.typeLabel || ac.t || 'Unknown',
        role: known.role ?? 'fixedwing',
        operator: known.operator ?? 'Unknown',
        operatorShort: known.operatorShort ?? '?',
        startTime: effectiveStartTime,
        timeAirborneSeconds: timeAirborne,
        historicalAverageSeconds: historicalAvg,
        estimatedReturnSeconds: Math.max(0, historicalAvg - timeAirborne),
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
        category: 'le',
}

      s.aircraftMap.set(hex, aircraftObj)

      if (justTookOff) {
        const entry: SortieEntry = {
          id: `sortie-${hex}-${now}`,
          hex,
          callsign,
          type: known.type || ac.t || 'Unknown',
          operatorShort: known.operatorShort ?? '?',
          startTime: now,
          endTime: null,
          durationSeconds: 0,
          maxAltitude: alt,
          status: 'active',
        }
        pushSortie(s, entry)
        s.sortieMaxAlt.set(hex, alt)
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

    // Reset known airframes that have been silent past the grace window (landed
    // / signal lost) back to dormant, then drop stale unknown contacts.
    pruneSilentKnown(now)
    for (const [hex, ac] of s.aircraftMap) {
      // Staleness via lastSeen — the old formula (now - startTime - timeAirborne*1000) was always 0
      if (!KNOWN_AIRCRAFT[hex] && (now - (ac.lastSeen ?? ac.startTime)) > 300_000) {
        s.aircraftMap.delete(hex)
      }
    }

    // Civil contacts are transient — drop any not refreshed in this 60s poll +
    // a grace window, so the AR sky view never shows planes that have left range.
    for (const [hex, ac] of s.civilMap) {
      if (now - (ac.lastSeen ?? 0) > 150_000) s.civilMap.delete(hex)
    }

    // Mark known aircraft not seen in this poll as inactive and record sortie end.
    // Police hexes are skipped — pollFastPolice owns their active/land lifecycle.
    for (const [hex, ac] of s.aircraftMap) {
      if (KNOWN_AIRCRAFT[hex] && !POLICE_HEXES.includes(hex) && !seenHexes.has(hex)) {
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
    const airborneCount = [...s.aircraftMap.values()].filter((a) => a.isActive).length
    console.log(`[ADSB.lol] ${count} VicPol seen this poll, ${airborneCount} airborne, ${s.aircraftMap.size} airframes seeded (${aircraft.length} total in range)`)
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
  // api.adsb.lol/v2/hex is the live, working endpoint. The old adsb.lol/v3 path
  // now 404s, so it's last-resort only (kept in case it returns one day).
  const candidates = [
    `https://api.adsb.lol/v2/hex/${hexes}`,
    `https://api.adsb.lol/v2/icao/${hexes}`,
    `https://adsb.lol/v3/ac/hex/${hexes}`,
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

    for (const ac of aircraft) {
      const hex = (ac.hex as string)?.toUpperCase()
      if (!hex || !POLICE_HEXES.includes(hex)) continue

      const latitude = ac.lat
      const longitude = ac.lon
      if (!validLatLng(latitude, longitude)) continue

      const altRaw = (ac.alt_geom != null && Number(ac.alt_geom) > 0)
        ? Number(ac.alt_geom)
        : (ac.alt_baro != null ? Number(ac.alt_baro) : 0)
      // ADSB.lol returns feet and knots — do NOT apply unit conversions
      const alt = Math.round(altRaw)   // already feet
      const speed = Math.round(Number(ac.gs ?? 0))   // already knots
      const heading = Math.round(ac.track ?? 0)
      const verticalRate = ac.baro_rate ?? ac.geom_rate ?? 0
      const callsign = ac.flight?.trim() || POLICE_CALLSIGNS[hex] || ''

      const known = KNOWN_AIRCRAFT[hex]
      const existing = s.aircraftMap.get(hex)
      const startTime = (existing && existing.startTime > 0) ? existing.startTime : now
      const timeAirborne = Math.round((now - startTime) / 1000)

      // Distinguish a genuine new sortie from a contact resuming after a brief
      // (or even >30s) signal dropout. We only "take off" — reset the fuel timer
      // and open a new sortie — when the slot was dormant or had LANDED. A
      // contact that merely went silent mid-air keeps its sortie + fuel state, so
      // a coverage gap no longer flaps it or refills the tank to 100%.
      const resuming = !!existing && existing.lastSeen != null && existing.landed !== true
      let justTookOff = false
      if (!resuming) {
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
        pushSortie(s, entry)
        s.sortieMaxAlt.set(hex, alt)
        if (existing) existing.startTime = sortieStartTime
        policeFuelCalcAt.set(hex, now) // start the fuel clock at takeoff
        policeLandedAt.delete(hex)
        saveToDisk()
        // Defer the takeoff notification until the full aircraft record below is
        // built, so Hermes can brief on complete telemetry (speed/heading/fuel).
        justTookOff = true
      } else {
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
        vs: Math.round(Number(verticalRate)), // ADSB.lol baro_rate/geom_rate already in fpm
      }

      const fuelEndurance = known?.fuelEnduranceMinutes ?? 270
      // Full tank on a fresh takeoff; otherwise integrate fuel forward from the
      // per-hex fuel clock (which kept draining through any silent gap), so the
      // bar tracks continuously across dropouts instead of resetting to 100%.
      const fuelPct = justTookOff
        ? 100
        : integratePoliceFuelPct(hex, existing?.fuelRemainingPercent ?? 100, now, alt, speed, heading, Math.round(Number(verticalRate)), fuelEndurance, effectiveTimeAirborne)
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
        category: 'le',
        landed: false,
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

    // Police hexes NOT refreshed this poll: hold through brief MLAT dropouts,
    // then judge landed vs silent-airborne — draining fuel the whole time.
    for (const hex of POLICE_HEXES) {
      const ac = s.aircraftMap.get(hex)
      if (!ac || ac.lastSeen == null) continue
      if (aircraft.some((a) => (a.hex as string)?.toUpperCase() === hex)) continue // got a fresh fix
      const gap = now - ac.lastSeen

      if (ac.landed) {
        // Already down — linger briefly at its last position, then go dormant.
        if (now - (policeLandedAt.get(hex) ?? ac.lastSeen) > LANDED_LINGER_MS) resetToDormant(ac)
        continue
      }

      // Keep the fuel bar draining against held last-known telemetry (level).
      ac.fuelRemainingPercent = integratePoliceFuelPct(
        hex, ac.fuelRemainingPercent ?? 100, now, ac.altitude, ac.speed, ac.heading, 0, ac.fuelEnduranceMinutes, ac.timeAirborneSeconds,
      )

      if (ac.isActive) {
        if (gap < POLICE_SILENT_DEBOUNCE_MS) continue // brief dropout: still active, hold position
        // Debounce expired. Low + slow when the signal died ⇒ it set down;
        // otherwise it's genuinely silent (lost signal while still airborne).
        if (ac.altitude <= LANDED_ALT_FT && ac.speed <= LANDED_SPD_KT) {
          markLandedPolice(ac, now)
        } else {
          ac.isActive = false
        }
      } else if ((ac.fuelRemainingPercent ?? 0) <= 0 || now >= silentExpiryMs(ac)) {
        // Silent-airborne but the tank is dry (or past its fuel-based endurance
        // bound) — it must be on the ground now.
        markLandedPolice(ac, now)
      }
    }

    // Non-fast known airframes (e.g. Air Wing) that have gone silent: keep their
    // fuel bar draining against held last-known telemetry every 3s — exactly like
    // the fast-police contacts above — so a silent aircraft visibly burns down
    // instead of freezing, and pruneSilentKnown can retire it the moment the tank
    // hits empty rather than on a stale frozen value.
    for (const hex of Object.keys(KNOWN_AIRCRAFT)) {
      if (POLICE_HEXES.includes(hex)) continue
      const ac = s.aircraftMap.get(hex)
      if (!ac || ac.isActive || ac.lastSeen == null || ac.landed) continue
      if (!validLatLng(ac.latitude, ac.longitude)) continue
      ac.fuelRemainingPercent = integratePoliceFuelPct(
        hex, ac.fuelRemainingPercent ?? 100, now, ac.altitude, ac.speed, ac.heading, 0, ac.fuelEnduranceMinutes, ac.timeAirborneSeconds,
      )
    }

    // Backstop for any non-fast known airframes (fast-police are handled above).
    pruneSilentKnown(now)
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
        (a) => validLatLng(a.latitude, a.longitude)
      )
    },

    /**
     * All airborne contacts for the AR "sky" view: law-enforcement (known, active)
     * + civil traffic in range, tagged via `category` and sorted nearest-first so
     * the cap keeps the most relevant overhead aircraft.
     */
    async getSkyContacts(limit = 80): Promise<Aircraft[]> {
      if (Date.now() - s.lastOpenSkyPoll > OPENSKY_POLL_INTERVAL) {
        await pollOpenSky()
      }
      const { lat, lng } = s.userGPS
      const le = [...s.aircraftMap.values()].filter(
        (a) => a.isActive && validLatLng(a.latitude, a.longitude)
      )
      const civil = [...s.civilMap.values()]
      const all = [...le, ...civil]
      all.sort(
        (a, b) =>
          haversineM(lat, lng, a.latitude, a.longitude) -
          haversineM(lat, lng, b.latitude, b.longitude)
      )
      return all.slice(0, limit)
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

      const report: Report & { pubMillis: number; lastSeenAt: number } = {
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
        pubMillis, // original publication timestamp for dynamic age calculation
        lastSeenAt: now, // wall-clock time this unit was last seen in the relay feed;
                         // refreshed on every re-report so a still-present unit's
                         // 45-min timer keeps resetting ("the unit is still there").
      }

      s.reportsMap.set(uuid, report)
      saveToDisk()
      touchWatchdog()
    },

    /** Add a user ("VPS") ground report to the pending pool (hidden until confirmed). */
    addUserReport(kind: GroundKind, lat: number, lng: number, sessionId: string): void {
      const now = Date.now()
      s.groundReports = s.groundReports.filter((r) => now - r.createdAt < REPORT_TTL_MS)
      s.groundReports.push({
        id: `g-${now}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        lat,
        lng,
        createdAt: now,
        sessionId: sessionId || `anon-${now}`,
      })
      saveToDisk()
    },

    /**
     * Drop ground units that haven't been seen in the relay feed for 45 min.
     * Each re-report refreshes lastSeenAt, so a unit that's still on the ground
     * (data keeps coming back) keeps its timer reset and stays on the map. Only
     * after REPORT_TTL_MS of silence is the unit pruned ("put down").
     */
    pruneReports(): void {
      const now = Date.now()
      for (const [uuid, r] of s.reportsMap) {
        // Fall back to pubMillis for legacy reports ingested before lastSeenAt existed.
        const lastSeen = (r as any).lastSeenAt ?? (r as any).pubMillis ?? (now - r.reportedAgo * 1000)
        if (now - lastSeen > REPORT_TTL_MS) s.reportsMap.delete(uuid)
      }
    },

    /** Get all ground reports: Waze relay + confirmed community (VPS) reports. */
    getReports(): Report[] {
      this.pruneReports()
      const waze = [...s.reportsMap.values()]
      const community = computeCommunityReports(s.groundReports).map((c): Report => ({
        id: c.id,
        wazeUuid: c.id,
        type: 'POLICE',
        subtype: null,
        kind: c.kind,
        lat: c.lat,
        lng: c.lng,
        street: 'Community report',
        city: '',
        reliability: 8,
        confidence: 8,
        nThumbsUp: 10, // >= 5 → confirmed (red) marker via the existing renderer
        reportedAgo: Math.round((Date.now() - c.lastReportAt) / 1000),
        lastConfirmedAgo: 0,
        descr: `${c.kind === 'marked' ? 'Marked unit' : c.kind === 'unmarked' ? 'Unmarked unit' : 'Hidden unit / camera'} · community ×${c.reportCount}`,
      }))
      return [...waze, ...community]
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
