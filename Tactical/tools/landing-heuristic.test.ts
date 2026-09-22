// Unit tests for the landed-vs-silent decision.
// Run: node --experimental-strip-types --test tools/landing-heuristic.test.ts
//
// The numbers here are not invented. The "rollout" cases are the real values that were
// being misjudged in the field: a King Air's last ADS-B frame before its transponder went
// off showed altitude 0 with 104 kt groundspeed, and an AW139 showed 0 / 55 kt. Both are
// landing rolls, and both failed the old "low AND slow" test — so aircraft that had landed
// were held as airborne and kept burning fuel until the tank ran dry.
//
// The counter-cases matter just as much: a low pass or a go-around must NOT be called a
// landing, because a dark aircraft on task is the event this app exists to flag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLanded, LANDED_ALT_FT } from '../lib/landing-heuristic.ts'

const pt = (ts: number, alt: number, spd: number) => ({ ts, alt, spd })
// Real tracks are stamped in epoch milliseconds, a poll apart (seconds to tens of
// seconds). Fixtures use a base clock and 30-second spacing so the window the rule
// measures is the window it sees in production.
const T0 = 1_767_000_000_000
const at = (secs: number, alt: number, spd: number) => pt(T0 + secs * 1000, alt, spd)

test('parked and still transmitting: low and slow', () => {
  assert.equal(looksLanded(0, 0, null), true)
  assert.equal(looksLanded(420, 12, []), true)
  assert.equal(looksLanded(-50, 0, null), true) // below field level, still ground
})

test('KING AIR ON THE ROLL, then transponder off — the reported bug', () => {
  // last frames: descending through 900 ft at 150 kt, then on the surface shedding speed
  const track = [at(0, 900, 150), at(30, 300, 140), at(60, 0, 120), at(90, 0, 104)]
  assert.equal(looksLanded(0, 104, track), true)
})

test('AW139 ON THE ROLL at 55 kt', () => {
  const track = [at(0, 600, 110), at(30, 100, 90), at(60, 0, 55)]
  assert.equal(looksLanded(0, 55, track), true)
})

test('a LOW PASS is not a landing and must stay silent', () => {
  const level = [at(0, 300, 110), at(30, 300, 112), at(60, 300, 110)]
  assert.equal(looksLanded(300, 110, level), false)
})

test('a GO-AROUND / climb-out is not a landing', () => {
  const climbing = [at(0, 100, 95), at(30, 200, 100), at(60, 350, 105)]
  assert.equal(looksLanded(350, 105, climbing), false)
})

test('cruise is never a landing, whatever the track says', () => {
  const track = [at(0, 8000, 160), at(30, 7900, 150)]
  assert.equal(looksLanded(7900, 150, track), false)
  assert.equal(looksLanded(3000, 10, track), false) // slow, but far above the ground gate
})

test('low and fast with no usable track stays silent (no false landings)', () => {
  assert.equal(looksLanded(0, 120, null), false)
  assert.equal(looksLanded(0, 120, []), false)
  assert.equal(looksLanded(0, 120, [at(0, 0, 118)]), false) // one sample is not a trend
})

test('a burst of same-second frames is not a trend', () => {
  const sameSecond = [pt(T0, 0, 130), pt(T0 + 30, 0, 120), pt(T0 + 60, 0, 95)]
  assert.equal(looksLanded(0, 95, sameSecond), false)
})

test('track order is not trusted — sorted by absolute timestamp', () => {
  const shuffled = [at(60, 0, 120), at(0, 900, 150), at(90, 0, 104), at(30, 300, 140)]
  assert.equal(looksLanded(0, 104, shuffled), true)
})

test('garbage in never produces a landing', () => {
  assert.equal(looksLanded(null, null, null), false)
  assert.equal(looksLanded(undefined, undefined, undefined), false)
  assert.equal(looksLanded(NaN, NaN, null), false)
  assert.equal(looksLanded(0, NaN, [{ ts: T0, alt: NaN, spd: NaN }]), false)
})

test('the ground gate is inclusive at its boundary', () => {
  assert.equal(looksLanded(LANDED_ALT_FT, 0, null), true)
  assert.equal(looksLanded(LANDED_ALT_FT + 1, 0, null), false)
})
