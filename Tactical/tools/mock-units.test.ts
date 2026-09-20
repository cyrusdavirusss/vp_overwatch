// Unit tests for the named mock scenarios.
// Run: node --experimental-strip-types --test tools/mock-units.test.ts
//
// The property that matters is the same one the flight mock is held to: synthetic
// contacts are opt-in behind an explicit flag and every one of them says MOCK out
// loud. A mock unit that could be mistaken for real traffic on a public map is not
// a fixture, it is misinformation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockScenario, mockContacts, mockAircraft, OVERSEAS_DRIVE_UNITS } from '../lib/mock-flight.ts'

test('the scenario is opt-in, and only by an explicit flag', () => {
  assert.equal(mockScenario('?mock=overseas-drive'), 'overseas-drive')
  assert.equal(mockScenario('?mock=1'), 'flight')
  assert.equal(mockScenario('?mock=flight'), 'flight')
  assert.equal(mockScenario(''), null)
  assert.equal(mockScenario('?mock=overseas'), null, 'partial names are not guessed at')
  assert.equal(mockScenario('?mock=0'), null)
  assert.equal(mockScenario('nonsense'), null)
})

test('overseas-drive yields exactly three units, at the street coordinates', () => {
  const units = mockContacts('overseas-drive', 1_700_000_000_000)
  assert.equal(units.length, 3)
  assert.equal(OVERSEAS_DRIVE_UNITS.length, 3, 'two ends and a midpoint is three points')

  for (const [i, u] of units.entries()) {
    const at = OVERSEAS_DRIVE_UNITS[i]
    assert.ok(at, `a fixture point exists for unit ${i + 1}`)
    assert.equal(u.latitude, at.lat)
    assert.equal(u.longitude, at.lng)
    // On a street, not in the air: no altitude, no speed.
    assert.equal(u.altitude, 0)
    assert.equal(u.speed, 0)
    // And every single one is labelled as what it is. label is optional on Aircraft,
    // so it has to be asserted present before it can be matched against.
    assert.match(u.operator, /MOCK/, `unit ${i + 1} must be flagged as mock`)
    assert.ok(u.label, `unit ${i + 1} must carry a label`)
    assert.match(u.label, /MOCK UNIT/)
    assert.match(u.label, /Overseas Dr/)
    assert.equal(u.isActive, true, 'mocks are live contacts, or the trail and cones would not engage')
    assert.ok(u.track.length >= 7, 'enough fixes for the trail and dead-reckoning paths')
  }
})

test('the units sit where the street actually is, and differ from each other', () => {
  const units = mockContacts('overseas-drive', 1_700_000_000_000)
  for (const u of units) {
    // Noble Park North, not the CBD and not the sea.
    assert.ok(u.latitude < -37.94 && u.latitude > -37.97, `lat in range, got ${u.latitude}`)
    assert.ok(u.longitude > 145.17 && u.longitude < 145.20, `lng in range, got ${u.longitude}`)
  }
  const spread = Math.max(...units.map((u) => u.latitude)) - Math.min(...units.map((u) => u.latitude))
  assert.ok(spread > 0.004, 'the three points are spread along the street, not stacked')
})

test('the flight scenario is unchanged', () => {
  const now = 1_700_000_000_000
  assert.deepEqual(mockContacts('flight', now).map((a) => a.id), mockAircraft(now).map((a) => a.id))
  assert.equal(mockContacts('flight', now).length, 2)
})

test('scenarios are pure functions of the clock', () => {
  const t = 1_700_000_000_000
  assert.deepEqual(mockContacts('overseas-drive', t), mockContacts('overseas-drive', t))
})
