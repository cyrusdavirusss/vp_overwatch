/**
 * A track point must carry the time the position was OBSERVED.
 *
 * The feed re-serves its latest known position on every poll, so a phone-call-fresh
 * response can still describe an aircraft from a minute ago (`seen_pos`). Dating that fix
 * with our receive time is what made markers freeze and then jump — the map draws each fix
 * at its own timestamp and dead-reckons forward from there.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observedFixMs, MAX_FIX_AGE_SEC, PROVIDER_CLOCK_TOLERANCE_MS } from '../lib/adsb/observed-time.ts'

const T = 1_790_650_200_000

test('a fresh fix is dated at the provider clock', () => {
  assert.equal(observedFixMs(T, 0, T + 120), T)
})

test('a stale position is dated when it was observed, not when it arrived', () => {
  // The real shape of the feed: median age 0.3 s, 90th percentile 26 s.
  assert.equal(observedFixMs(T, 26, T), T - 26_000)
  assert.equal(observedFixMs(T, 0.3, T), T - 300)
})

test('observed time plus the reported age is the provider clock', () => {
  // Contract, not snapshot: the two fields have to agree or the map extrapolates from
  // the wrong instant, and no single expected value would catch a units error.
  for (const age of [0, 1, 5, 26, 59.4]) {
    assert.ok(Math.abs(observedFixMs(T, age, T) + age * 1000 - T) < 1e-6)
  }
})

test('a missing or unusable age falls back to the receive time', () => {
  // Never invent an age: the fallback can only make a fix look fresher than it is.
  for (const bad of [null, undefined, NaN, Infinity, -3] as const) {
    assert.equal(observedFixMs(T, bad, T), T)
  }
})

test('a plausible provider clock wins, an implausible one loses', () => {
  const local = T + 1000
  // Inside the tolerance we keep the feed's clock: it removes our own request latency.
  assert.equal(observedFixMs(T, 0, local), T)
  // Outside it, a wrong clock must not be allowed to date every fix on the map.
  assert.equal(observedFixMs(T + PROVIDER_CLOCK_TOLERANCE_MS * 2, 0, local), local)
  assert.equal(observedFixMs(T - PROVIDER_CLOCK_TOLERANCE_MS * 2, 0, local), local)
})

test('an absurd age is clamped rather than dating a fix years back', () => {
  assert.equal(observedFixMs(T, 10_000, T), T - MAX_FIX_AGE_SEC * 1000)
})

test('a garbage local clock still yields a finite timestamp', () => {
  const before = Date.now()
  const out = observedFixMs(null, 5, NaN)
  const after = Date.now()
  assert.ok(Number.isFinite(out))
  assert.ok(out >= before - 6000 && out <= after - 4000)
})
