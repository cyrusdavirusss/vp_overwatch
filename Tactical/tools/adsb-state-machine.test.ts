// Unit tests for the pure aircraft state machine.
// Run: node --experimental-strip-types --test tools/adsb-state-machine.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ADSBAircraft } from '../lib/adsb/exchange-adapter.ts'
import {
  applyObservation,
  classifyMovement,
  deriveLastObservedAt,
  emptyRecord,
  sweepAircraft,
  type ApplyContext,
} from '../lib/adsb/state-machine.ts'

const FRESH = { freshSeconds: 60, unavailableSeconds: 300 }
const MOVE = { airborneAltFt: 400, groundAltFt: 150, airborneSpeedKt: 40, groundSpeedKt: 20, confirmObservations: 2 }

function obs(partial: Partial<ADSBAircraft>): ADSBAircraft {
  return {
    icao24: '7c6db8', registration: 'VH-PVO', callsign: null,
    latitude: -37.8, longitude: 144.9, onGround: false,
    altitudeBaro: null, altitudeGeo: null, groundSpeed: null, track: null,
    verticalRate: null, seenPos: 1, seen: 1, squawk: null, emergency: null,
    provider: 'adsb_exchange', ...partial,
  }
}

function ctx(nowMs: number, providerHealthy = true, providerNowMs: number | null = nowMs): ApplyContext {
  return { nowMs, providerNowMs, providerHealthy, freshness: FRESH, movement: MOVE }
}

test('deriveLastObservedAt: seen_pos is a DURATION, not a timestamp', () => {
  // provider now = 1000_000 ms, seen_pos = 5s → observed 5000ms earlier.
  assert.equal(deriveLastObservedAt(5, 1_000_000, 999_999), 995_000)
  assert.equal(deriveLastObservedAt(null, 1_000_000, 1), null)
})

test('applyObservation: feet→metres once; nulls preserved', () => {
  const r0 = emptyRecord('VH-PVO', 'AW139', 0)
  const { record } = applyObservation(r0, obs({ altitudeBaro: 1000, groundSpeed: null }), ctx(10_000))
  assert.ok(Math.abs(record.altitudeMetres! - 304.8) < 0.001)
  assert.equal(record.groundSpeedKt, null) // not coerced to 0
  assert.equal(record.mappingStatus, 'verified')
})

test('classifyMovement: onGround wins; helicopter low+slow not called airborne', () => {
  assert.equal(classifyMovement(obs({ onGround: true, altitudeBaro: 900, groundSpeed: 100 }), MOVE), 'ground')
  assert.equal(classifyMovement(obs({ altitudeBaro: 100, groundSpeed: 5 }), MOVE), 'ground')
  assert.equal(classifyMovement(obs({ altitudeBaro: 1200, groundSpeed: 90 }), MOVE), 'airborne')
  // ambiguous (mid alt, no speed) → unknown, do not invent
  assert.equal(classifyMovement(obs({ altitudeBaro: 250, groundSpeed: null }), MOVE), 'unknown')
})

test('takeoff requires N consecutive airborne obs (debounced, no flap)', () => {
  let rec = emptyRecord('VH-PVO', 'AW139', 0)
  // Establish confirmed ground first.
  rec = applyObservation(rec, obs({ onGround: true }), ctx(1_000)).record
  rec = applyObservation(rec, obs({ onGround: true }), ctx(2_000)).record
  assert.equal(rec.confirmedMovement, 'ground')

  // 1st airborne obs → candidate, not yet confirmed → no takeoff.
  let step = applyObservation(rec, obs({ altitudeBaro: 1500, groundSpeed: 90 }), ctx(3_000))
  rec = step.record
  assert.equal(step.events.length, 0)
  assert.equal(rec.confirmedMovement, 'ground')

  // 2nd airborne obs → confirmed → takeoff fires exactly once.
  step = applyObservation(rec, obs({ altitudeBaro: 1600, groundSpeed: 95 }), ctx(4_000))
  rec = step.record
  assert.equal(rec.confirmedMovement, 'airborne')
  assert.equal(step.events.filter((e) => e.eventType === 'takeoff').length, 1)
  const takeoffKey = step.events[0].dedupKey

  // 3rd airborne obs → no duplicate takeoff.
  step = applyObservation(rec, obs({ altitudeBaro: 1700, groundSpeed: 95 }), ctx(5_000))
  rec = step.record
  assert.equal(step.events.length, 0)

  // Landing after N ground obs, same episode key root.
  step = applyObservation(rec, obs({ onGround: true }), ctx(6_000)); rec = step.record
  step = applyObservation(rec, obs({ onGround: true }), ctx(7_000)); rec = step.record
  const landings = step.events.filter((e) => e.eventType === 'landing')
  assert.equal(landings.length, 1)
  assert.equal(landings[0].dedupKey, takeoffKey.replace('takeoff', 'landing')) // same episode seq
})

test('telemetry_not_seen only when provider healthy; outage holds stale', () => {
  let rec = emptyRecord('VH-PVO', 'AW139', 0)
  rec = applyObservation(rec, obs({ altitudeBaro: 1500, groundSpeed: 90, seenPos: 1 }), ctx(10_000)).record
  rec = applyObservation(rec, obs({ altitudeBaro: 1500, groundSpeed: 90, seenPos: 1 }), ctx(11_000)).record

  // Provider UNHEALTHY, aircraft aged well past unavailable → must NOT fire.
  let sweep = sweepAircraft(rec, ctx(11_000 + 400_000, /*healthy*/ false))
  assert.equal(sweep.events.length, 0)
  assert.equal(sweep.record.state, 'stale')

  // Provider healthy, aged out → telemetry_not_seen exactly once.
  sweep = sweepAircraft(rec, ctx(11_000 + 400_000, /*healthy*/ true))
  const notSeen = sweep.events.filter((e) => e.eventType === 'telemetry_not_seen')
  assert.equal(notSeen.length, 1)
  assert.equal(sweep.record.state, 'unavailable')
  assert.match(notSeen[0].message, /does not indicate any incident/)

  // Sweeping again does not re-fire (idempotent key uses notSeenSeq).
  const again = sweepAircraft(sweep.record, ctx(11_000 + 500_000, true))
  assert.equal(again.events.filter((e) => e.eventType === 'telemetry_not_seen').length, 0)
})

test('reappeared fires after unavailable→live', () => {
  let rec = emptyRecord('VH-PVO', 'AW139', 0)
  rec = applyObservation(rec, obs({ altitudeBaro: 1500, groundSpeed: 90 }), ctx(10_000)).record
  rec = applyObservation(rec, obs({ altitudeBaro: 1500, groundSpeed: 90 }), ctx(11_000)).record
  rec = sweepAircraft(rec, ctx(11_000 + 400_000, true)).record
  assert.equal(rec.state, 'unavailable')

  const step = applyObservation(rec, obs({ altitudeBaro: 1500, groundSpeed: 90, seenPos: 1 }), ctx(11_000 + 500_000))
  assert.equal(step.events.filter((e) => e.eventType === 'reappeared').length, 1)
})

test('no events for unresolved / no-position aircraft', () => {
  const r0 = emptyRecord('VH-PVX', 'unknown', 0)
  const sweep = sweepAircraft(r0, ctx(1_000_000, true))
  assert.equal(sweep.events.length, 0)
})
