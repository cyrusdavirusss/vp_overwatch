// Unit tests for the mock-flight review fixture.
// Run: node --experimental-strip-types --test tools/mock-flight.test.ts
//
// A fixture is still code, and this one is attached to the live aircraft feed (behind a
// flag) — so it is worth pinning that it produces one of each role, that it is a pure
// function of the clock, and that its contacts are labelled as mock rather than looking
// like real traffic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockAircraft, mockRequested } from '../lib/mock-flight.ts'

const T = 1_800_000_000_000

test('mock mode is opt-in by explicit flag only', () => {
  assert.equal(mockRequested('?mock=1'), true)
  assert.equal(mockRequested('?foo=1&mock=1'), true)
  assert.equal(mockRequested('?mock=0'), false)
  assert.equal(mockRequested(''), false)
  assert.equal(mockRequested('?mock'), false)
  assert.equal(mockRequested('nonsense'), false)
})

test('one aircraft of each role, because the roles render and model differently', () => {
  const ac = mockAircraft(T)
  assert.equal(ac.length, 2)
  const roles = ac.map((a) => a.role).sort()
  assert.deepEqual(roles, ['fixedwing', 'rotary'])
})

test('every mock contact says it is a mock', () => {
  for (const a of mockAircraft(T)) {
    // The label is drawn in the callout and the operator in the detail panel; both must
    // say so, or a screenshot could pass as real tracking.
    assert.match(a.label || '', /MOCK/i, `label was ${a.label}`)
    assert.match(a.operator, /MOCK/i, `operator was ${a.operator}`)
    assert.equal(a.operatorShort, 'MOCK')
  }
})

test('it is a pure function of the clock', () => {
  const a = mockAircraft(T), b = mockAircraft(T)
  assert.deepEqual(a.map((x) => [x.latitude, x.longitude]), b.map((x) => [x.latitude, x.longitude]))
  // ...and it actually moves: a minute later nothing is in the same place.
  const later = mockAircraft(T + 60_000)
  assert.notEqual(a[0].latitude, later[0].latitude)
  assert.notEqual(a[1].longitude, later[1].longitude)
})

test('the track is real enough for the trail and dead-reckoning to work', () => {
  for (const ac of mockAircraft(T)) {
    assert.ok(ac.track.length > 10, `trail was ${ac.track.length} points`)
    const last = ac.track[ac.track.length - 1]
    // The newest point must match the aircraft's own position, or the marker and its
    // trail would disagree, and it must carry an absolute timestamp or dead-reckoning
    // has no age to work from.
    assert.ok(Math.abs(last.lat - ac.latitude) < 1e-9)
    assert.ok(Math.abs(last.lng - ac.longitude) < 1e-9)
    assert.equal(typeof last.ts, 'number')
    assert.ok(last.ts! <= T + 1, 'the newest fix cannot be in the future')
    // Chronological, ascending: the trail renderer assumes it.
    for (let i = 1; i < ac.track.length; i++) {
      assert.ok(ac.track[i].ts! >= ac.track[i - 1].ts!, 'track must be chronological')
    }
  }
})

test('mock contacts are marked live, so the cones and prediction engage', () => {
  for (const a of mockAircraft(T)) {
    assert.equal(a.isActive, true)
    assert.ok(a.altitude > 0)
    assert.ok(a.speed > 0)
  }
})
