// Unit tests for the lost-signal dispatch policy.
// Run: node --experimental-strip-types --test tools/stealth-threshold.test.ts
//
// The rule under test is the operator's: a call or text must NOT go out when the
// aircraft has only been unseen for a few seconds. These tests pin the boundary and,
// just as importantly, the fail-closed behaviour when the outage cannot be measured.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_STEALTH_MIN_OUTAGE_SECONDS,
  lostSignalOutageSeconds,
  mayDispatchLostSignal,
  stealthMinOutageSeconds,
} from '../lib/alerts/policy.ts'

const NOW = 1_800_000_000_000  // fixed clock; never assert against Date.now()
const seenAgo = (seconds: number) => NOW - seconds * 1000

test('measures the outage from the last observed time', () => {
  assert.equal(lostSignalOutageSeconds(seenAgo(45), NOW), 45)
  assert.equal(lostSignalOutageSeconds(seenAgo(0), NOW), 0)
})

test('an unmeasurable outage is null, not zero', () => {
  // null would be a false "just seen" and a number would be a false outage.
  assert.equal(lostSignalOutageSeconds(null, NOW), null)
  assert.equal(lostSignalOutageSeconds(undefined, NOW), null)
  assert.equal(lostSignalOutageSeconds(Number.NaN, NOW), null)
  // Seen in the future = the clocks disagree. That is not a measured outage either.
  assert.equal(lostSignalOutageSeconds(NOW + 10_000, NOW), null)
})

test('a 45 second gap does NOT ring the phone', () => {
  const d = mayDispatchLostSignal('call', lostSignalOutageSeconds(seenAgo(45), NOW))
  assert.equal(d.allowed, false)
  if (d.allowed) throw new Error('expected the call to be refused')   // narrows the union
  assert.match(d.reason, /45\.0s/, 'the reason should say how long it was unseen')
  assert.match(d.reason, /60s floor/)
})

test('the same 45 second gap does not send a text either', () => {
  assert.equal(mayDispatchLostSignal('sms', 45).allowed, false)
})

test('60 seconds exactly is allowed — the floor is inclusive', () => {
  assert.equal(mayDispatchLostSignal('call', 60).allowed, true)
})

test('well past the floor is allowed', () => {
  assert.equal(mayDispatchLostSignal('call', 301).allowed, true)
  assert.equal(mayDispatchLostSignal('sms', 90).allowed, true)
})

test('push and in-app never wait for the floor', () => {
  // They do not interrupt anyone, so suppressing them would lose information for free.
  assert.equal(mayDispatchLostSignal('push', 5).allowed, true)
  assert.equal(mayDispatchLostSignal('inapp', 0).allowed, true)
})

test('an unmeasurable outage refuses the intrusive channels (fail closed)', () => {
  const d = mayDispatchLostSignal('call', null)
  assert.equal(d.allowed, false)
  if (d.allowed) throw new Error('expected the call to be refused')   // narrows the union
  assert.match(d.reason, /fail closed/)
  // ...but still lets the quiet channels through, because they are still useful.
  assert.equal(mayDispatchLostSignal('push', null).allowed, true)
})

test('the floor is configurable, and a bad value falls back to the default', () => {
  const saved = process.env.STEALTH_MIN_OUTAGE_SECONDS
  try {
    process.env.STEALTH_MIN_OUTAGE_SECONDS = '120'
    assert.equal(stealthMinOutageSeconds(), 120)
    assert.equal(mayDispatchLostSignal('call', 90).allowed, false)
    assert.equal(mayDispatchLostSignal('call', 120).allowed, true)

    process.env.STEALTH_MIN_OUTAGE_SECONDS = 'not-a-number'
    assert.equal(stealthMinOutageSeconds(), DEFAULT_STEALTH_MIN_OUTAGE_SECONDS)
    assert.equal(stealthMinOutageSeconds(), 60)

    process.env.STEALTH_MIN_OUTAGE_SECONDS = '-30'
    assert.equal(stealthMinOutageSeconds(), DEFAULT_STEALTH_MIN_OUTAGE_SECONDS)
  } finally {
    if (saved === undefined) delete process.env.STEALTH_MIN_OUTAGE_SECONDS
    else process.env.STEALTH_MIN_OUTAGE_SECONDS = saved
  }
})
