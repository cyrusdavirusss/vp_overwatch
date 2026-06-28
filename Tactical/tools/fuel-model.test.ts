// Sandbox test for lib/fuel-model.ts — asserts the physical invariants the
// fuel-burn model must satisfy, then prints a scenario report. Run compiled
// via tsc + node (see how it's invoked from the shell); exits non-zero on any
// failed assertion.

import {
  PERF_AW139,
  PERF_EC135,
  PERF_C208,
  AirframePerf,
  FlightSample,
  Wind,
  CALM,
  instantFuelFlowKgH,
  trueAirspeedKt,
  integrateFuelKg,
  publishedEnduranceMin,
  maxRemainingEnduranceSec,
  densityRatio,
} from '../lib/fuel-model'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  if (!cond) failures++
  console.log(`  [${tag}] ${name}${detail ? '  — ' + detail : ''}`)
}
function approx(a: number, b: number, tolFrac: number) {
  return Math.abs(a - b) <= Math.abs(b) * tolFrac
}

// Level steady fuel flow at a given true airspeed (helper).
const levelFF = (p: AirframePerf, tas: number, alt = 1000) =>
  instantFuelFlowKgH(p, tas, alt, 0, 0, 1)

// Build a constant-condition track of N minutes at fixed gs/alt/vs.
function steadyTrack(mins: number, gsKt: number, altFt: number, vsFpm = 0, trackDeg = 0): FlightSample[] {
  const pts: FlightSample[] = []
  for (let t = 0; t <= mins * 60; t += 60) pts.push({ tSec: t, altFt, gsKt, trackDeg, vsFpm })
  return pts
}

console.log('═══ FUEL MODEL SANDBOX TEST ═══\n')

for (const p of [PERF_AW139, PERF_EC135, PERF_C208]) {
  console.log(`── ${p.type} (${p.cls}) ──`)
  const endur = publishedEnduranceMin(p)
  console.log(`  derived max endurance: ${endur.toFixed(0)} min (${(endur / 60).toFixed(2)} h)`)

  // 1. Loiter level flight for the full endurance burns ≈ usable fuel.
  const loiterBurn = integrateFuelKg(steadyTrack(endur, p.loiterTASkt, 1000), p)
  check('loiter@endurance burns ≈ usable fuel', approx(loiterBurn.fuelBurnedKg, p.usableFuelKg, 0.02),
    `${loiterBurn.fuelBurnedKg.toFixed(0)}kg vs ${p.usableFuelKg}kg`)

  // 2. Cruise burns more per hour than loiter.
  const ffCruise = levelFF(p, p.cruiseTASkt)
  const ffLoiter = levelFF(p, p.loiterTASkt)
  check('cruise FF > loiter FF', ffCruise > ffLoiter, `${ffCruise.toFixed(0)} > ${ffLoiter.toFixed(0)} kg/h`)

  // 3. Climbing burns more than level at same speed; descent burns less.
  const ffClimb = instantFuelFlowKgH(p, p.cruiseTASkt, 1000, 1000, 0, 1)
  const ffDesc = instantFuelFlowKgH(p, p.cruiseTASkt, 1000, -1000, 0, 1)
  check('climb FF > level FF', ffClimb > ffCruise, `${ffClimb.toFixed(0)} > ${ffCruise.toFixed(0)}`)
  check('descent FF < level FF', ffDesc < ffCruise, `${ffDesc.toFixed(0)} < ${ffCruise.toFixed(0)}`)

  // 4. Acceleration increases burn.
  const ffAccel = instantFuelFlowKgH(p, p.cruiseTASkt, 1000, 0, 1.0, 1)
  check('accel FF > steady FF', ffAccel > ffCruise, `${ffAccel.toFixed(0)} > ${ffCruise.toFixed(0)}`)

  // 5. Altitude (lower density) reduces parasite burn at cruise speed.
  const ffSL = levelFF(p, p.cruiseTASkt, 0)
  const ffAlt = levelFF(p, p.cruiseTASkt, 10000)
  check('cruise FF lower at 10000ft than SL', ffAlt < ffSL, `${ffAlt.toFixed(0)} < ${ffSL.toFixed(0)}`)

  // 6. Headwind raises TAS → more burn; tailwind lowers it → less burn
  //    (same groundspeed = cruise).
  const head: Wind = { dirFromDeg: 0, speedKt: 30 } // wind from ahead (track 0)
  const tail: Wind = { dirFromDeg: 180, speedKt: 30 }
  const tasHead = trueAirspeedKt(p.cruiseTASkt, 0, head)
  const tasTail = trueAirspeedKt(p.cruiseTASkt, 0, tail)
  const ffHead = instantFuelFlowKgH(p, tasHead, 1000, 0, 0, 1)
  const ffTail = instantFuelFlowKgH(p, tasTail, 1000, 0, 0, 1)
  check('headwind TAS = gs+30kt', approx(tasHead, p.cruiseTASkt + 30, 0.01), `${tasHead.toFixed(0)}kt`)
  check('headwind FF > calm cruise FF', ffHead > ffCruise, `${ffHead.toFixed(0)} > ${ffCruise.toFixed(0)}`)
  check('tailwind FF < calm cruise FF', ffTail < ffCruise, `${ffTail.toFixed(0)} < ${ffCruise.toFixed(0)}`)

  // 7. Weight: heavier (full fuel) burns more than light at low/induced speed.
  const lowSpeed = p.loiterTASkt * 0.6
  const ffHeavy = instantFuelFlowKgH(p, lowSpeed, 1000, 0, 0, 1.0)
  const ffLight = instantFuelFlowKgH(p, lowSpeed, 1000, 0, 0, 0.3)
  check('heavy FF > light FF at low speed', ffHeavy > ffLight, `${ffHeavy.toFixed(0)} > ${ffLight.toFixed(0)}`)

  console.log('')
}

// Helicopter-specific: hover burns more than cruise (U-shaped power curve).
const ffHover = levelFF(PERF_AW139, 0)
const ffAwCruise = levelFF(PERF_AW139, PERF_AW139.cruiseTASkt)
check('AW139 hover FF > cruise FF', ffHover > ffAwCruise, `${ffHover.toFixed(0)} > ${ffAwCruise.toFixed(0)} kg/h`)

// ── Silent-expiry demonstration: same airframe, two very different sorties ──
console.log('\n── silent-expiry scenarios (AW139) ──')
function reportSortie(label: string, track: FlightSample[], wind: (s: FlightSample) => Wind = () => CALM) {
  const r = integrateFuelKg(track, PERF_AW139, wind)
  const remMin = maxRemainingEnduranceSec(r.fuelRemainingKg, PERF_AW139) / 60
  console.log(`  ${label}`)
  console.log(`     burned ${r.fuelBurnedKg.toFixed(0)}kg, remaining ${r.fuelRemainingKg.toFixed(0)}kg`
    + ` → could still fly ${remMin.toFixed(0)} more min`)
  return remMin
}

// A) Just took off 5 min ago, gentle cruise → lots of fuel left.
const justUp = reportSortie('took off 5 min ago (cruise):', steadyTrack(5, PERF_AW139.cruiseTASkt, 1500))
// B) 4 hours of hard low orbit (high power), then goes dark → little left.
const longHard = reportSortie('4 h of low-speed orbit then dark:', steadyTrack(240, 55, 1200))
// C) 2 h mixed with a 40kt headwind on transit legs.
const headwindRun = reportSortie('2 h cruise into 40kt headwind:',
  steadyTrack(120, PERF_AW139.cruiseTASkt, 2000, 0, 0), () => ({ dirFromDeg: 0, speedKt: 40 }))

check('fresh sortie leaves more endurance than 4h-hard one', justUp > longHard,
  `${justUp.toFixed(0)} > ${longHard.toFixed(0)} min`)
check('4h hard orbit nearly exhausts fuel', longHard < 60, `${longHard.toFixed(0)} min left`)
check('headwind transit consumes meaningful fuel', headwindRun < justUp,
  `${headwindRun.toFixed(0)} < ${justUp.toFixed(0)} min`)

// ── incremental (per-poll, as the live store does it) vs batch integration ──
// The store integrates burn each poll using wall-clock dt; verify that matches
// integrateFuelKg over the same profile.
console.log('\n── incremental (per-poll) vs batch integration (AW139, 60min cruise) ──')
{
  const p = PERF_AW139
  const wind: Wind = CALM
  // Incremental: 3s polls for 60 min, cruise level flight.
  let remKg = p.usableFuelKg
  let prevTas = trueAirspeedKt(p.cruiseTASkt, 0, wind)
  const dtH = 3 / 3600
  for (let t = 3; t <= 3600; t += 3) {
    const tas = trueAirspeedKt(p.cruiseTASkt, 0, wind)
    const accel = ((tas - prevTas) * 0.514444) / (dtH * 3600)
    const ff = instantFuelFlowKgH(p, tas, 1500, 0, accel, remKg / p.usableFuelKg)
    remKg = Math.max(0, remKg - ff * dtH)
    prevTas = tas
  }
  const incBurned = p.usableFuelKg - remKg
  const batch = integrateFuelKg(steadyTrack(60, p.cruiseTASkt, 1500), p, () => wind)
  console.log(`  incremental burned ${incBurned.toFixed(1)}kg  vs  batch ${batch.fuelBurnedKg.toFixed(1)}kg`)
  check('incremental ≈ batch (within 2%)', approx(incBurned, batch.fuelBurnedKg, 0.02))
}

console.log(`\n═══ ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ═══`)
process.exit(failures === 0 ? 0 : 1)
