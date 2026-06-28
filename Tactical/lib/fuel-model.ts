// ─────────────────────────────────────────────────────────────────────────
// Physics-informed fuel-burn model for VP-Overwatch known airframes.
//
// Estimates instantaneous fuel flow from ADS-B telemetry — groundspeed,
// altitude, vertical speed, derived longitudinal acceleration — plus winds
// aloft, then integrates it over a track to estimate fuel burned and remaining
// endurance. Used to decide how long a "silent" (off-ADS-B) airframe could
// still plausibly be airborne before it must be out of fuel.
//
// This is a TACTICAL ESTIMATE, not certified performance data. Coefficients are
// tuned so that nominal best-endurance flight reproduces each type's published
// endurance, with physically-shaped corrections for how hard the airframe is
// actually being flown. Factors modelled:
//   • aircraft type & class (helicopter vs fixed-wing, per-tail specs)
//   • airspeed (U-shaped power curve for helis; drag bucket for fixed-wing)
//   • air density / altitude (ISA), splitting parasite vs induced power
//   • climb / descent (vertical speed → extra or reduced power)
//   • longitudinal acceleration (kinetic energy added per unit time)
//   • wind (groundspeed → true airspeed via the wind triangle)
//   • aircraft weight (fuel burned reduces induced/climb power demand)
// ─────────────────────────────────────────────────────────────────────────

export type AirframeClass = 'helicopter' | 'fixedwing'

export interface AirframePerf {
  type: string
  cls: AirframeClass
  usableFuelKg: number // usable fuel, full tanks
  oewKg: number // operating empty weight + typical crew/payload (no fuel)
  cruiseTASkt: number // nominal cruise true airspeed
  loiterTASkt: number // best-endurance (minimum fuel flow) airspeed
  ffCruiseKgH: number // fuel flow at cruiseTAS, level, ISA sea level
  ffLoiterKgH: number // minimum fuel flow at loiterTAS — sets max endurance
}

export interface Wind {
  dirFromDeg: number // meteorological convention: direction wind blows FROM
  speedKt: number
}
export const CALM: Wind = { dirFromDeg: 0, speedKt: 0 }

export interface FlightSample {
  tSec: number
  altFt: number
  gsKt: number // groundspeed (what ADS-B reports)
  trackDeg: number // ground track
  vsFpm: number // vertical speed (+up)
}

// ── unit constants ──────────────────────────────────────────────────────
const KT_TO_MS = 0.514444
const FPM_TO_MS = 0.00508
const G = 9.80665
const LHV_JET_A = 43e6 // J/kg lower heating value
// Effective propulsive/thermal efficiency converting shaft energy demand to
// fuel for the *incremental* climb/accel terms (engine + drivetrain losses).
const ETA_INCREMENTAL = 0.26

// ISA density ratio σ = ρ/ρ0 in the troposphere, from pressure altitude (ft).
export function densityRatio(altFt: number): number {
  const a = 1 - 6.8753e-6 * Math.max(0, altFt)
  if (a <= 0) return 0.25
  return Math.min(1.05, Math.pow(a, 4.2561))
}

// Groundspeed → true airspeed using the wind triangle. Wind is FROM dirFrom,
// so the air mass moves TOWARD dirFrom+180. air = ground − windVector.
export function trueAirspeedKt(gsKt: number, trackDeg: number, wind: Wind): number {
  const tr = (trackDeg * Math.PI) / 180
  const gE = gsKt * Math.sin(tr)
  const gN = gsKt * Math.cos(tr)
  const windTo = ((wind.dirFromDeg + 180) * Math.PI) / 180
  const wE = wind.speedKt * Math.sin(windTo)
  const wN = wind.speedKt * Math.cos(windTo)
  return Math.hypot(gE - wE, gN - wN)
}

// Instantaneous fuel flow (kg/h) for one sample.
//   tas:        true airspeed (kt), already wind-corrected
//   accelMps2:  longitudinal acceleration along the flight path (+speeding up)
//   weightFrac: current weight / max-fuel weight (1.0 = full tanks)
export function instantFuelFlowKgH(
  perf: AirframePerf,
  tas: number,
  altFt: number,
  vsFpm: number,
  accelMps2: number,
  weightFrac = 1,
): number {
  const sigma = densityRatio(altFt)

  // ── airspeed bowl: minimum at loiterTAS, rising both ways ──────────────
  // High-speed side is parasite drag (∝ density); low-speed side is induced /
  // (for helis) hover power (∝ 1/density and ∝ weight).
  const hiCoef = (perf.ffCruiseKgH - perf.ffLoiterKgH) / Math.pow(perf.cruiseTASkt - perf.loiterTASkt, 2)
  const ffHoverEnd = 1.2 * perf.ffCruiseKgH // approx burn at zero airspeed
  const loCoef = (ffHoverEnd - perf.ffLoiterKgH) / Math.pow(perf.loiterTASkt, 2)

  let ff: number
  if (tas >= perf.loiterTASkt) {
    ff = perf.ffLoiterKgH + hiCoef * Math.pow(tas - perf.loiterTASkt, 2) * sigma
  } else {
    ff = perf.ffLoiterKgH + loCoef * Math.pow(perf.loiterTASkt - tas, 2) * (weightFrac / sigma)
  }

  // ── climb / descent power (m·g·Vz) → incremental fuel ──────────────────
  const vzMps = vsFpm * FPM_TO_MS
  const weightKg = perf.oewKg + perf.usableFuelKg * weightFrac
  const climbW = weightKg * G * vzMps // watts (signed)
  ff += (climbW / (LHV_JET_A * ETA_INCREMENTAL)) * 3600

  // ── longitudinal acceleration (d/dt of kinetic energy) → fuel ──────────
  if (accelMps2 > 0) {
    const vMps = tas * KT_TO_MS
    const accelW = weightKg * vMps * accelMps2
    ff += (accelW / (LHV_JET_A * ETA_INCREMENTAL)) * 3600
  }

  // Floor at flight idle, ceiling at max-continuous burn.
  const idle = 0.35 * perf.ffCruiseKgH
  const max = 1.6 * perf.ffCruiseKgH
  return Math.max(idle, Math.min(max, ff))
}

export interface BurnResult {
  fuelBurnedKg: number
  fuelRemainingKg: number
  lastFuelFlowKgH: number
}

// Integrate fuel burn across a track. windAt(sample) supplies winds aloft for
// each sample (default calm). Acceleration is derived between samples.
export function integrateFuelKg(
  track: FlightSample[],
  perf: AirframePerf,
  windAt: (s: FlightSample) => Wind = () => CALM,
): BurnResult {
  const pts = [...track].sort((a, b) => a.tSec - b.tSec)
  let burned = 0
  let lastFF = perf.ffCruiseKgH
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i]
    const next = pts[i + 1]
    const dt = next.tSec - s.tSec
    if (dt <= 0 || dt > 1800) continue // skip gaps > 30 min (unknown profile)
    const wind = windAt(s)
    const tas = trueAirspeedKt(s.gsKt, s.trackDeg, wind)
    const tasNext = trueAirspeedKt(next.gsKt, next.trackDeg, windAt(next))
    const accel = ((tasNext - tas) * KT_TO_MS) / dt
    const weightFrac = Math.max(0, (perf.usableFuelKg - burned) / perf.usableFuelKg)
    const ff = instantFuelFlowKgH(perf, tas, s.altFt, s.vsFpm, accel, weightFrac)
    burned += ff * (dt / 3600)
    lastFF = ff
  }
  return {
    fuelBurnedKg: burned,
    fuelRemainingKg: Math.max(0, perf.usableFuelKg - burned),
    lastFuelFlowKgH: lastFF,
  }
}

// Maximum further time aloft (seconds) given remaining fuel — uses the
// minimum (best-endurance) fuel flow, i.e. the *longest* it could still fly.
// This is the conservative bound for "could it still be airborne?".
export function maxRemainingEnduranceSec(fuelRemainingKg: number, perf: AirframePerf): number {
  return (fuelRemainingKg / perf.ffLoiterKgH) * 3600
}

// Published-spec max endurance (minutes) at best-endurance speed, full tanks.
export function publishedEnduranceMin(perf: AirframePerf): number {
  return (perf.usableFuelKg / perf.ffLoiterKgH) * 60
}

// ── Per-airframe performance specs ────────────────────────────────────────
// Type-level published figures (surveillance configs vary; treated as
// estimates). Endurance derives from usableFuelKg / ffLoiterKgH.
export const PERF_AW139: AirframePerf = {
  type: 'AW139',
  cls: 'helicopter',
  usableFuelKg: 1530, // ~standard internal fuel
  oewKg: 4600, // OEW + crew/mission kit, no fuel
  cruiseTASkt: 165,
  loiterTASkt: 75,
  ffCruiseKgH: 410,
  ffLoiterKgH: 335, // → ~274 min endurance
}
export const PERF_EC135: AirframePerf = {
  type: 'EC135',
  cls: 'helicopter',
  usableFuelKg: 560,
  oewKg: 1900,
  cruiseTASkt: 137,
  loiterTASkt: 65,
  ffCruiseKgH: 205,
  ffLoiterKgH: 160, // → ~210 min endurance
}
export const PERF_C208: AirframePerf = {
  type: 'C208',
  cls: 'fixedwing',
  usableFuelKg: 1010, // ~332 US gal Jet-A
  oewKg: 2150,
  cruiseTASkt: 175,
  loiterTASkt: 110,
  ffCruiseKgH: 185,
  ffLoiterKgH: 162, // → ~374 min endurance
}

// Map each known ICAO hex to its performance profile.
export const PERF_BY_HEX: Record<string, AirframePerf> = {
  '7C7F8C': PERF_AW139, // VH-PVH
  '7C1F40': PERF_AW139, // VH-PVK
  '7C4EF2': PERF_AW139, // VH-PVO
  '7C4EF4': PERF_AW139, // VH-PVQ
  '7C4EF5': PERF_AW139, // VH-PVR
  '7C4EE8': PERF_AW139, // VH-PVE
  '7C2B22': PERF_EC135, // VH-PVI
  '7CF102': PERF_C208, // VH-AFC (AFP, fixed-wing)
}

export function perfForHex(hex: string): AirframePerf | undefined {
  return PERF_BY_HEX[hex.toUpperCase()]
}
