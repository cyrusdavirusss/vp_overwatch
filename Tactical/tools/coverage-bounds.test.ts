// The coverage clamp on the position that steers the area-wide ADS-B sweep.
//
// That position is written by an UNAUTHENTICATED visitor request (`POST
// /api/gps/set`), and it decides where the 100 km sweep looks. Clamping it is what
// stops a stranger pointing the app's feed at Alice Springs and thrashing it.
//
// The clamp must NOT be tight enough to break the app: Melbourne, Geelong and the
// whole operating area have to pass through untouched, and a value on the edge has
// to land exactly on the edge rather than being nudged inside (a nudged edge would
// silently move a legitimate boundary fix).
import test from 'node:test'
import assert from 'node:assert/strict'
import { clampToCoverage, VICTORIA_COVERAGE, DEFAULT_CENTRE } from '../lib/data.ts'

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol

test('everything inside the operating area passes through unchanged', () => {
  const inside = [
    { lat: -37.8136, lng: 144.9631 }, // Melbourne CBD
    { lat: -38.1499, lng: 144.3617 }, // Geelong
    { lat: -37.9343, lng: 145.1805 }, // south-east metro
    { lat: -38.4, lng: 145.7 },       // Wilsons Prom-ish
    { lat: -36.75, lng: 144.28 },     // Bendigo
    { lat: -34.18, lng: 142.16 },     // Mildura, the far north-west corner
    { lat: -37.0, lng: 147.5 },       // the north-east
  ]
  for (const p of inside) {
    const c = clampToCoverage(p.lat, p.lng)
    assert.ok(near(c.lat, p.lat) && near(c.lng, p.lng), `${p.lat},${p.lng} moved to ${c.lat},${c.lng}`)
  }
})

test('a coordinate outside the state is clamped to the nearest edge, not rejected', () => {
  const sydney = clampToCoverage(-33.8688, 151.2093)
  assert.equal(sydney.lat, -33.8688)          // inside north-south, so unchanged
  assert.equal(sydney.lng, VICTORIA_COVERAGE.east)

  const alice = clampToCoverage(-23.6978, 133.8807)
  assert.equal(alice.lat, VICTORIA_COVERAGE.north)
  assert.equal(alice.lng, VICTORIA_COVERAGE.west)

  const hobart = clampToCoverage(-42.8821, 147.3272)
  assert.equal(hobart.lat, VICTORIA_COVERAGE.south)
  assert.equal(hobart.lng, 147.3272)
})

test('a value already on the edge is left exactly on the edge', () => {
  const onEdge = clampToCoverage(VICTORIA_COVERAGE.south, VICTORIA_COVERAGE.east)
  assert.equal(onEdge.lat, VICTORIA_COVERAGE.south)
  assert.equal(onEdge.lng, VICTORIA_COVERAGE.east)
})

test('non-finite input falls back to the public default centre instead of NaN', () => {
  for (const [lat, lng] of [[NaN, 144.9], [-37.8, NaN], [Infinity, 144.9], [-37.8, -Infinity]]) {
    const c = clampToCoverage(lat, lng)
    assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng), `${lat},${lng} produced ${c.lat},${c.lng}`)
    assert.equal(c.lat, DEFAULT_CENTRE.lat)
    assert.equal(c.lng, DEFAULT_CENTRE.lng)
  }
})

test('the box contains the whole operating area by construction', () => {
  assert.ok(VICTORIA_COVERAGE.south < -39 && VICTORIA_COVERAGE.north > -34, 'latitude range must span the state')
  assert.ok(VICTORIA_COVERAGE.west < 141 && VICTORIA_COVERAGE.east > 150, 'longitude range must span the state')
})
