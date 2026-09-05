/**
 * Tracked-aircraft roster + environment-configurable tracking thresholds.
 * Server-only. No secrets here.
 */
import type { FreshnessConfig, MovementConfig, ProximityConfigMetres } from './types.ts'

export interface TrackedAircraftDef {
  registration: string
  description: string
  /** Neutral type label used in notifications (never alarmist). */
  typeLabel: string
}

/** The four MVP aircraft. Descriptions/labels are static; hex is resolved live. */
export const TRACKED_AIRCRAFT: TrackedAircraftDef[] = [
  { registration: 'VH-PVO', description: 'Leonardo AW139 helicopter', typeLabel: 'AW139 helicopter' },
  { registration: 'VH-PVP', description: 'Leonardo AW139 helicopter', typeLabel: 'AW139 helicopter' },
  { registration: 'VH-PVQ', description: 'Leonardo AW139 helicopter', typeLabel: 'AW139 helicopter' },
  { registration: 'VH-PVE', description: 'Beechcraft 350i Super King Air', typeLabel: 'King Air 350i' },
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

export function restIntervalSeconds(): number {
  return envInt('ADSB_REST_INTERVAL_SECONDS', 30)
}

export function ingestionMode(): 'streaming' | 'rest' {
  return process.env.ADSB_INGESTION_MODE === 'streaming' ? 'streaming' : 'rest'
}
