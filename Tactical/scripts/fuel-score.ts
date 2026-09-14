/**
 * VP-Overwatch fuel-ratio scorer.
 *
 * Runs the real physics fuel-burn model (lib/fuel-model.ts) over the telemetry
 * sample-tracks collected by fuel-collector.py and derives, per flight, the
 * fuel burned and the empirical fuel ratios we want to calibrate against.
 *
 * Idempotent: each flight (keyed by its start_iso) is scored once and appended
 * to <HEX>.scores.jsonl; a per-aircraft rollup is written to
 * fuel-scores-summary.json. Safe to run repeatedly (e.g. on every landing).
 *
 * Run:  node --experimental-strip-types scripts/fuel-score.ts [--hex 7c4ef5] [--dir data/fuel-flights]
 *
 * Winds: default calm. The pipeline's winds-aloft can be wired via windAt later
 * for a more accurate TAS; calm slightly under-reads burn on windy days.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { integrateFuelKg, perfForHex, publishedEnduranceMin, CALM, type Wind, type FlightSample } from '../lib/fuel-model.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const JET_A_KG_PER_L = 0.804 // Jet-A1 density ~0.804 kg/L
const KMH_TO_KT = 0.539957

// Open-Meteo pressure levels → approx ISA pressure-altitude (ft). Winds aloft
// are fetched at these levels and interpolated by altitude in windAt().
const WIND_LEVELS: { hpa: number; altFt: number }[] = [
  { hpa: 1000, altFt: 360 },
  { hpa: 925, altFt: 2500 },
  { hpa: 850, altFt: 4900 },
  { hpa: 700, altFt: 9880 },
  { hpa: 600, altFt: 13800 },
  { hpa: 500, altFt: 18280 },
]

interface WindLevel { altFt: number; dirFromDeg: number; speedKt: number }

// Fetch a winds-aloft profile for a flight from Open-Meteo (no API key), matched
// to the flight's start hour. Returns null on any failure → caller uses calm.
async function fetchWindProfile(lat: number, lon: number, startIso: string): Promise<WindLevel[] | null> {
  const speedVars = WIND_LEVELS.map((l) => `wind_speed_${l.hpa}hPa`).join(',')
  const dirVars = WIND_LEVELS.map((l) => `wind_direction_${l.hpa}hPa`).join(',')
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&hourly=${speedVars},${dirVars}&past_days=2&forecast_days=1&timezone=UTC`
  try {
    const j: any = await fetch(url, { signal: AbortSignal.timeout(6000) }).then((r) => r.json())
    const times: string[] = j?.hourly?.time ?? []
    if (!times.length) return null
    const targetHour = startIso.slice(0, 13) // "YYYY-MM-DDTHH"
    let idx = times.findIndex((t) => t.slice(0, 13) === targetHour)
    if (idx < 0) idx = times.length - 1 // fall back to latest available
    const prof: WindLevel[] = []
    for (const l of WIND_LEVELS) {
      const spd = j.hourly[`wind_speed_${l.hpa}hPa`]?.[idx]
      const dir = j.hourly[`wind_direction_${l.hpa}hPa`]?.[idx]
      if (typeof spd === 'number' && typeof dir === 'number') {
        prof.push({ altFt: l.altFt, dirFromDeg: dir, speedKt: spd * KMH_TO_KT })
      }
    }
    return prof.length ? prof : null
  } catch {
    return null
  }
}

// Build a windAt(sample) that interpolates the profile by altitude. Direction is
// interpolated as a vector (u,v) to avoid the 0/360 wrap-around problem.
function makeWindAt(profile: WindLevel[] | null): (s: FlightSample) => Wind {
  if (!profile || profile.length === 0) return () => CALM
  const p = [...profile].sort((a, b) => a.altFt - b.altFt)
  const toUV = (w: WindLevel) => {
    const to = ((w.dirFromDeg + 180) * Math.PI) / 180
    return { u: w.speedKt * Math.sin(to), v: w.speedKt * Math.cos(to) }
  }
  return (s: FlightSample): Wind => {
    const alt = Number.isFinite(s.altFt) ? s.altFt : 0
    let lo = p[0], hi = p[p.length - 1]
    if (alt <= lo.altFt) { hi = lo } else if (alt >= hi.altFt) { lo = hi }
    else {
      for (let i = 0; i < p.length - 1; i++) {
        if (alt >= p[i].altFt && alt <= p[i + 1].altFt) { lo = p[i]; hi = p[i + 1]; break }
      }
    }
    const span = hi.altFt - lo.altFt
    const f = span > 0 ? (alt - lo.altFt) / span : 0
    const a = toUV(lo), b = toUV(hi)
    const u = a.u + (b.u - a.u) * f
    const v = a.v + (b.v - a.v) * f
    const speedKt = Math.hypot(u, v)
    // vector points TO; convert back to meteorological FROM
    const dirTo = (Math.atan2(u, v) * 180) / Math.PI
    const dirFromDeg = (dirTo + 180 + 360) % 360
    return { dirFromDeg, speedKt }
  }
}

interface Sample { tSec?: number; ts: number; altFt: number | null; gsKt: number | null; trackDeg: number | null; vsFpm: number | null; lat: number | null; lon: number | null }
interface Flight { meta: { hex: string; callsign: string; type: string }; summary: Record<string, any>; samples: Sample[] }

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def
}

function readJsonl(path: string): any[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

async function scoreFlight(f: Flight, useWinds: boolean) {
  const perf = perfForHex(f.meta.hex)
  if (!perf) return { error: `no perf profile for hex ${f.meta.hex}` }

  // Keep only samples the model can integrate (needs numeric gs/track/alt).
  const track: FlightSample[] = f.samples
    .filter((s) => Number.isFinite(s.altFt) && Number.isFinite(s.gsKt) && Number.isFinite(s.trackDeg))
    .map((s) => ({
      tSec: Number.isFinite(s.tSec) ? (s.tSec as number) : (s.ts - f.samples[0].ts) / 1000,
      altFt: s.altFt as number,
      gsKt: s.gsKt as number,
      trackDeg: s.trackDeg as number,
      vsFpm: Number.isFinite(s.vsFpm) ? (s.vsFpm as number) : 0,
    }))
  if (track.length < 2) return { error: `too few usable samples (${track.length})` }

  // Winds aloft: fetch a profile at the flight's mean position + start hour.
  let profile: WindLevel[] | null = null
  if (useWinds) {
    const pts = f.samples.filter((s) => s.lat != null && s.lon != null)
    const mlat = pts.length ? pts.reduce((a, s) => a + (s.lat as number), 0) / pts.length : -37.81
    const mlon = pts.length ? pts.reduce((a, s) => a + (s.lon as number), 0) / pts.length : 144.96
    profile = await fetchWindProfile(mlat, mlon, f.summary.start_iso ?? new Date().toISOString())
  }
  const windAt = makeWindAt(profile)

  const r = integrateFuelKg(track, perf, windAt)
  const durMin = f.summary.duration_min ?? (track[track.length - 1].tSec - track[0].tSec) / 60
  const durH = durMin / 60
  const pathKm = f.summary.path_km ?? 0

  // representative wind at 2500ft (typical orbit) for transparency
  const orbitWind = windAt({ tSec: 0, altFt: 2500, gsKt: 0, trackDeg: 0, vsFpm: 0 })
  const avgFuelFlowKgH = durH > 0 ? r.fuelBurnedKg / durH : 0
  return {
    callsign: f.meta.callsign,
    hex: f.meta.hex,
    type: f.meta.type,
    start_iso: f.summary.start_iso,
    duration_min: round(durMin, 1),
    path_km: round(pathKm, 1),
    usable_samples: track.length,
    // --- fuel results ---
    fuel_burned_kg: round(r.fuelBurnedKg, 1),
    fuel_burned_L: round(r.fuelBurnedKg / JET_A_KG_PER_L, 1),
    fuel_remaining_kg: round(r.fuelRemainingKg, 1),
    // --- the ratios we want to calibrate ---
    avg_fuel_flow_kgh: round(avgFuelFlowKgH, 1),
    fuel_per_km_kg: pathKm > 0 ? round(r.fuelBurnedKg / pathKm, 3) : null,
    fuel_per_hour_L: round((avgFuelFlowKgH) / JET_A_KG_PER_L, 1),
    burn_ratio_vs_cruise: round(avgFuelFlowKgH / perf.ffCruiseKgH, 3),
    burn_ratio_vs_loiter: round(avgFuelFlowKgH / perf.ffLoiterKgH, 3),
    fuel_used_pct: round((r.fuelBurnedKg / perf.usableFuelKg) * 100, 1),
    endurance_used_pct: round((durMin / publishedEnduranceMin(perf)) * 100, 1),
    // --- provenance ---
    winds: profile ? 'open-meteo' : 'calm',
    wind_2500ft: profile ? { dirFromDeg: round(orbitWind.dirFromDeg, 0), speedKt: round(orbitWind.speedKt, 1) } : null,
  }
}

function round(n: number, d = 1): number {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}

function mean(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x))
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 2) : null
}

async function main() {
  const dir = arg('--dir', join(HERE, '..', 'data', 'fuel-flights'))!
  const onlyHex = arg('--hex')?.toLowerCase()
  const useWinds = !process.argv.includes('--calm')
  if (!existsSync(dir)) { console.log(`no data dir ${dir}`); return }

  const flightFiles = readdirSync(dir).filter(
    (fn) => /^[0-9a-f]{6}\.jsonl$/i.test(fn) && (!onlyHex || fn.toLowerCase().startsWith(onlyHex)),
  )
  const summary: Record<string, any> = {}

  for (const fn of flightFiles) {
    const hex = fn.replace('.jsonl', '')
    const flights = readJsonl(join(dir, fn)) as Flight[]
    const scoresPath = join(dir, `${hex}.scores.jsonl`)
    const already = new Set(readJsonl(scoresPath).map((s) => s.start_iso))

    let newScored = 0
    const allScores = readJsonl(scoresPath)
    for (const f of flights) {
      if (already.has(f.summary?.start_iso)) continue
      const sc = await scoreFlight(f, useWinds)
      if ((sc as any).error) { console.log(`SKIP ${hex} ${f.summary?.start_iso}: ${(sc as any).error}`); continue }
      appendFileSync(scoresPath, JSON.stringify(sc) + '\n')
      allScores.push(sc)
      newScored++
      console.log(`SCORED ${(sc as any).callsign} ${(sc as any).start_iso}  ${(sc as any).duration_min}min  ` +
        `burned ${(sc as any).fuel_burned_kg}kg (${(sc as any).fuel_burned_L}L)  ` +
        `avg ${(sc as any).avg_fuel_flow_kgh}kg/h  ×cruise ${(sc as any).burn_ratio_vs_cruise}  ` +
        `winds ${(sc as any).winds}`)
    }

    if (allScores.length) {
      const cs = allScores[0].callsign
      summary[hex] = {
        callsign: cs,
        type: allScores[0].type,
        flights_scored: allScores.length,
        new_this_run: newScored,
        mean_duration_min: mean(allScores.map((s) => s.duration_min)),
        total_fuel_kg: round(allScores.reduce((a, s) => a + (s.fuel_burned_kg || 0), 0), 1),
        mean_fuel_flow_kgh: mean(allScores.map((s) => s.avg_fuel_flow_kgh)),
        mean_fuel_per_km_kg: mean(allScores.map((s) => s.fuel_per_km_kg).filter((x) => x != null)),
        mean_burn_ratio_vs_cruise: mean(allScores.map((s) => s.burn_ratio_vs_cruise)),
        mean_burn_ratio_vs_loiter: mean(allScores.map((s) => s.burn_ratio_vs_loiter)),
      }
    }
  }

  if (Object.keys(summary).length) {
    writeFileSync(join(dir, 'fuel-scores-summary.json'), JSON.stringify(summary, null, 2))
    console.log('\n=== fuel-ratio summary ===')
    for (const h of Object.keys(summary)) {
      const s = summary[h]
      console.log(`${s.callsign} (${s.type}): ${s.flights_scored} flights, ` +
        `mean ${s.mean_fuel_flow_kgh}kg/h, ${s.mean_fuel_per_km_kg ?? '-'}kg/km, ` +
        `×cruise ${s.mean_burn_ratio_vs_cruise}`)
    }
  } else {
    console.log('no completed flights to score yet')
  }
}

await main()
