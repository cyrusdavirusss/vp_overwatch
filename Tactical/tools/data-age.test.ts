// Ground-feed freshness — the values the header shows and the threshold it uses.
//
// The load-bearing assertion is the coupling: the staleness threshold must be
// clear of the relay's own poll cadence, or a relay that is behaving perfectly
// ("no new alerts in this 30-minute window") reads as dead. Same class of bug as
// the watchdog's WD_SILENT_LIMIT, which is why it gets a test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDataAge, GROUND_STALE_AFTER_SEC } from '../lib/data.ts'

// Deployed relay cadence (tools/waze-relay POLL_SECONDS).
const RELAY_POLL_SECONDS = 1800

test('an unknown age is not rendered as a number', () => {
  assert.equal(formatDataAge(undefined), '—')
})

test('the store sentinel reads as "never", not as a huge number of seconds', () => {
  assert.equal(formatDataAge(9999), 'never')
})

test('a fresh ingest reads as "now"', () => {
  assert.equal(formatDataAge(0), 'now')
  assert.equal(formatDataAge(45), 'now')
  assert.equal(formatDataAge(89), 'now')
})

test('minutes and hours are rendered in the units a person reads', () => {
  assert.equal(formatDataAge(90), '2m ago')
  assert.equal(formatDataAge(300), '5m ago')
  assert.equal(formatDataAge(1800), '30m ago')
  assert.equal(formatDataAge(3599), '60m ago')
  assert.equal(formatDataAge(3600), '1h ago')
  assert.equal(formatDataAge(5400), '1h 30m ago')
  assert.equal(formatDataAge(7200), '2h ago')
})

test('the stale threshold clears the relay cadence, so a healthy relay never reads stale', () => {
  assert.ok(
    GROUND_STALE_AFTER_SEC >= RELAY_POLL_SECONDS * 2,
    `threshold ${GROUND_STALE_AFTER_SEC}s must be at least two relay ticks (${RELAY_POLL_SECONDS * 2}s)`,
  )
  // The legitimate range between ticks is 0..cadence — none of it may read stale.
  for (const age of [0, 60, 900, RELAY_POLL_SECONDS]) {
    assert.ok(age < GROUND_STALE_AFTER_SEC, `${age}s must not be stale`)
  }
  // One missed tick is exactly the condition the indicator exists to show.
  assert.ok(RELAY_POLL_SECONDS * 2 >= GROUND_STALE_AFTER_SEC, 'one missed tick must trip the indicator')
})
