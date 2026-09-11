/**
 * Tracked-aircraft roster + environment-configurable tracking thresholds.
 * Server-only. No secrets here.
 */
import type { Bbox, FreshnessConfig, MovementConfig, ProximityConfigMetres } from './types.ts'

export interface TrackedAircraftDef {
  registration: string
  description: string
  /** Neutral type label used in notifications (never alarmist). */
  typeLabel: string
  /** Known Mode-S hex (icao24), used as the default reg->hex mapping for
   *  providers that can't resolve it live (OpenSky). Overridable via
   *  ADSB_HEX_<REG>. These are public broadcast identifiers, not secrets. */
  hex?: string
  callsign?: string
}

/** Victoria Police Air Wing — the four tracked aircraft, with their public
 *  Mode-S hex codes (used directly by the OpenSky provider). */
export const TRACKED_AIRCRAFT: TrackedAircraftDef[] = [
  { registration: 'VH-PVO', description: 'Leonardo AW139 helicopter', typeLabel: 'AW139 helicopter', hex: '7c4ef2', callsign: 'POL30' },
  { registration: 'VH-PVQ', description: 'Leonardo AW139 helicopter', typeLabel: 'AW139 helicopter', hex: '7c4ef4', callsign: 'POL31' },
  { registration: 'VH-PVR', description: 'Leonardo AW139 helicopter', typeLabel: 'AW139 helicopter', hex: '7c4ef5', callsign: 'POL32' },
  { registration: 'VH-PVE', description: 'Beechcraft King Air 350ER', typeLabel: 'King Air 350ER', hex: '7c4ee8', callsign: 'POL35' },
]

export function trackedRegistrations(): string[] {
  return TRACKED_AIRCRAFT.map((a) => a.registration)
}

export function trackedDescriptions(): Map<string, string> {
  return new Map(TRACKED_AIRCRAFT.map((a) => [a.registration, a.description]))
}

export function typeLabelFor(registration: string): string {
  return TRACKED_AIRCRAFT.find((a) => a.registration === registration)?.typeLabel ?? 'aircraft'
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function freshnessConfig(): FreshnessConfig {
  return {
    freshSeconds: envInt('ADSB_FRESH_SECONDS', 60),
    unavailableSeconds: envInt('ADSB_UNAVAILABLE_SECONDS', 300),
  }
}

/**
 * Movement thresholds. Deliberately NOT a single `alt>1000m && spd>50` rule —
 * helicopters loiter low and slow. Uses a low airborne-altitude floor combined
 * with a multi-observation confirmation (see state-machine).
 */
export function movementConfig(): MovementConfig {
  return {
    airborneAltFt: envInt('ADSB_AIRBORNE_ALT_FT', 400),   // ~120 m AGL
    groundAltFt: envInt('ADSB_GROUND_ALT_FT', 150),       // ~45 m
    airborneSpeedKt: envInt('ADSB_AIRBORNE_SPEED_KT', 40),
    groundSpeedKt: envInt('ADSB_GROUND_SPEED_KT', 20),
    confirmObservations: envInt('ADSB_CONFIRM_OBSERVATIONS', 2),
  }
}

export function proximityConfig(): ProximityConfigMetres {
  return {
    enterMetres: envInt('PROXIMITY_ENTER_METRES', 30_000),
    exitMetres: envInt('PROXIMITY_EXIT_METRES', 33_000),
  }
}

export function locationExpirySeconds(): number {
  return envInt('LOCATION_EXPIRY_SECONDS', 600)
}

/**
 * Poll interval for the ingestion worker. An explicit ADSB_REST_INTERVAL_SECONDS
 * always wins. Otherwise, when running OpenSky ANONYMOUSLY (no OAuth2 creds), the
 * interval auto-paces to the free daily credit budget so we never exceed it;
 * authenticated OpenSky and ADS-B Exchange default to 30s.
 */
export function restIntervalSeconds(): number {
  const explicit = process.env.ADSB_REST_INTERVAL_SECONDS
  if (explicit && explicit.trim() !== '') {
    const n = Number(explicit)
    if (Number.isFinite(n) && n > 0) return n
  }
  // Pace every OpenSky mode to its daily credit budget (anon 400, authed 4000)
  // so we never overspend. adsbexchange (paid, no credit metering) uses 30s.
  if (adsbProvider() === 'opensky') return openSkyBudgetIntervalSeconds()
  return 30
}

/**
 * Seconds between polls that exhaust exactly the OpenSky daily credit budget.
 * A /states/all call with no bounding box (our icao24 filter) covers the whole
 * world = 4 credits; anonymous tier = 400 credits/day → 100 calls/day → 864s.
 * Both figures are env-overridable.
 */
export function openSkyBudgetIntervalSeconds(): number {
  // Authenticated accounts (OAuth2 client OR basic username/password) get ~4000
  // credits/day (Standard); anonymous ~400.
  const authed = openSkyAuthenticated()
  const creditsPerDay = envInt('OPENSKY_DAILY_CREDITS', authed ? 4000 : 400)
  const creditsPerCall = openSkyCreditsPerCall()
  return Math.ceil((86400 * creditsPerCall) / Math.max(1, creditsPerDay))
}

export function openSkyAuthenticated(): boolean {
  return !!(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) ||
         !!(process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD)
}

/** Greater Melbourne (metro + surrounds); ~2.5 sq deg → 1 OpenSky credit/call. */
export const MELBOURNE_BBOX: Bbox = { lamin: -38.6, lomin: 144.0, lamax: -37.2, lomax: 145.8 }

/**
 * Bounding box for OpenSky queries. Default: Melbourne only (1 credit/call, so
 * fast polling fits the budget) — the tradeoff is aircraft outside the box are
 * not seen. OPENSKY_BBOX="lamin,lomin,lamax,lomax" sets a custom box;
 * OPENSKY_BBOX=global uses the whole-world icao24 query (4 credits/call).
 */
export function openSkyBbox(): Bbox | null {
  const v = process.env.OPENSKY_BBOX
  if (v && v.trim() !== '') {
    const t = v.trim().toLowerCase()
    if (t === 'global' || t === 'world' || t === 'off' || t === 'none') return null
    const p = t.split(',').map((x) => Number(x))
    if (p.length === 4 && p.every((n) => Number.isFinite(n))) {
      return { lamin: p[0], lomin: p[1], lamax: p[2], lomax: p[3] }
    }
  }
  return MELBOURNE_BBOX
}

export function bboxAreaSqDeg(b: Bbox): number {
  return Math.abs(b.lamax - b.lamin) * Math.abs(b.lomax - b.lomin)
}

/** OpenSky /states/all credit cost by requested area band. */
export function creditsForArea(areaSqDeg: number): number {
  if (areaSqDeg <= 25) return 1
  if (areaSqDeg <= 100) return 2
  if (areaSqDeg <= 400) return 3
  return 4
}

export function openSkyCreditsPerCall(): number {
  const env = process.env.OPENSKY_CREDITS_PER_CALL
  if (env && env.trim() !== '') { const n = Number(env); if (Number.isFinite(n) && n > 0) return n }
  const b = openSkyBbox()
  return b ? creditsForArea(bboxAreaSqDeg(b)) : 4
}

export function ingestionMode(): 'streaming' | 'rest' {
  return process.env.ADSB_INGESTION_MODE === 'streaming' ? 'streaming' : 'rest'
}

export function adsbProvider(): 'opensky' | 'adsbexchange' {
  // Default OpenSky: keyless and works with the baked Mode-S hexes. Set
  // ADSB_PROVIDER=adsbexchange (with a key) to use the Enterprise gateway.
  return process.env.ADSB_PROVIDER === 'adsbexchange' ? 'adsbexchange' : 'opensky'
}

/**
 * Static registration→hex override (Mode-S hex), for providers that can't
 * resolve reg→hex live (e.g. OpenSky). Env var per registration, '-'→'_':
 *   ADSB_HEX_VH_PVO=7c... . Returns lowercase hex or null.
 */
export function hexOverride(registration: string): string | null {
  const reg = registration.trim().toUpperCase()
  const key = 'ADSB_HEX_' + reg.replace(/[^A-Z0-9]/g, '_')
  const v = process.env[key]
  if (v && v.trim()) return v.trim().toLowerCase()
  const def = TRACKED_AIRCRAFT.find((a) => a.registration === reg)
  return def?.hex ? def.hex.toLowerCase() : null
}
