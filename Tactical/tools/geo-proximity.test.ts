// Unit tests for geodesic distance + proximity hysteresis.
// Run: node --experimental-strip-types --test tools/geo-proximity.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  haversineMetres,
  stepProximity,
  initialProximityState,
  DEFAULT_PROXIMITY_CONFIG,
} from '../lib/geo/haversine.ts'

const MELB = { lat: -37.8136, lng: 144.9631 }

test('haversineMetres: zero distance for identical points', () => {
  assert.equal(haversineMetres(MELB, MELB), 0)
})

test('haversineMetres: ~known distance Melbourne→Sydney (~713 km)', () => {
  const SYD = { lat: -33.8688, lng: 151.2093 }
  const d = haversineMetres(MELB, SYD)
  assert.ok(Math.abs(d - 713_000) < 15_000, `got ${d}`)
})

test('haversineMetres: 1° of latitude ≈ 111 km', () => {
  const d = haversineMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
  assert.ok(Math.abs(d - 111_195) < 500, `got ${d}`)
})

test('haversineMetres: non-finite coordinate → NaN (no false 0-distance)', () => {
  assert.ok(Number.isNaN(haversineMetres({ lat: NaN, lng: 0 }, MELB)))
})

// Build a point a given metres due north of MELB for controlled crossings.
function northOf(base: { lat: number; lng: number }, metres: number) {
  return { lat: base.lat + metres / 111_195, lng: base.lng }
}

test('proximity: fires once on entry inside 30km, then disarms (no flapping)', () => {
  let s = initialProximityState()
  // Start well outside (40km) → no fire.
  let d = stepProximity(s, northOf(MELB, 40_000), MELB); s = d.state
  assert.equal(d.fired, false)
  // Cross to 25km (inside 30km enter) → fire.
  d = stepProximity(s, northOf(MELB, 25_000), MELB); s = d.state
  assert.equal(d.fired, true)
  // Still inside at 28km → must NOT fire again (disarmed).
  d = stepProximity(s, northOf(MELB, 28_000), MELB); s = d.state
  assert.equal(d.fired, false)
  // Drift out to 31km (between 30 and 33) → still disarmed (anti-flap band).
  d = stepProximity(s, northOf(MELB, 31_000), MELB); s = d.state
  assert.equal(d.fired, false)
  assert.equal(s.armed, false)
})

test('proximity: re-arms only past 33km exit radius, then can fire again', () => {
  let s = initialProximityState()
  s = stepProximity(s, northOf(MELB, 25_000), MELB).state // fire + disarm
  // 32km: inside exit band, stays disarmed.
  s = stepProximity(s, northOf(MELB, 32_000), MELB).state
  assert.equal(s.armed, false)
  // 34km: beyond 33km → re-arm.
  s = stepProximity(s, northOf(MELB, 34_000), MELB).state
  assert.equal(s.armed, true)
  // Re-enter to 20km → fires again.
  const d = stepProximity(s, northOf(MELB, 20_000), MELB)
  assert.equal(d.fired, true)
})

test('proximity: unknown position carries state, never fires', () => {
  let s = initialProximityState()
  const d = stepProximity(s, { lat: NaN, lng: NaN }, MELB)
  assert.equal(d.fired, false)
  assert.equal(d.state, s)
})

test('proximity: config exit clamped to >= enter defends against bad config', () => {
  const s = { armed: false, inside: true }
  // exit < enter: exit test falls back to enter so we still re-arm sanely.
  const d = stepProximity(s, northOf(MELB, 40_000), MELB, { enterMetres: 30_000, exitMetres: 10_000 })
  assert.equal(d.state.armed, true)
})

test('DEFAULT_PROXIMITY_CONFIG is 30km/33km', () => {
  assert.equal(DEFAULT_PROXIMITY_CONFIG.enterMetres, 30_000)
  assert.equal(DEFAULT_PROXIMITY_CONFIG.exitMetres, 33_000)
})
