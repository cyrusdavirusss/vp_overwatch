// Unit tests for the privileged helicopter sighting.
// Run: node --experimental-strip-types --test tools/stealth-sighting.test.ts
//
// Two properties are load-bearing here, and both are about NOT overstating:
//
//  1. The corroboration rule still holds for everyone else. An anonymous pin is a claim
//     about someone else's position, and one such claim must not put a unit on every
//     client's map. The privilege bypasses that rule for exactly one authenticated
//     submitter — it must not leak to the kind, or anyone could broadcast by posting
//     `kind: 'helicopter'`.
//
//  2. A helicopter ages on a SHORT clock. It is the one report that moves the whole
//     time it exists: 130-150 kt for 40 minutes is ~160 km, a quarter of the state. The
//     police window would leave a position on the map that the aircraft left an hour ago.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCommunityReports,
  ttlForKind,
  HELICOPTER_TTL_MS,
  REPORT_TTL_MS,
  CONFIRM_COUNT,
  type PendingGroundReport,
  type GroundKind,
} from '../lib/community-reports.ts'

const NOW = 1_800_000_000_000

/** A pending report, 20 m from the reference point unless moved. */
function report(
  i: number,
  opts: {
    kind?: GroundKind
    lat?: number
    lng?: number
    agoMs?: number
    authoritative?: boolean
    accuracyM?: number
    sessionId?: string
  } = {}
): PendingGroundReport {
  return {
    id: `r${i}`,
    kind: opts.kind ?? 'helicopter',
    lat: opts.lat ?? -37.9537,
    lng: opts.lng ?? 145.1859,
    createdAt: NOW - (opts.agoMs ?? 0),
    sessionId: opts.sessionId ?? `s${i}`,
    authoritative: opts.authoritative,
    accuracyM: opts.accuracyM,
  }
}

// ── the clock ───────────────────────────────────────────────────────────────

test('a helicopter ages on a shorter clock than a ground unit', () => {
  assert.equal(ttlForKind('helicopter'), HELICOPTER_TTL_MS)
  for (const k of ['marked', 'unmarked', 'hidden'] as GroundKind[]) {
    assert.equal(ttlForKind(k), REPORT_TTL_MS, `${k} keeps the police window`)
  }
  // The whole point: it must be strictly shorter, or a moving aircraft is served stale.
  assert.ok(HELICOPTER_TTL_MS < REPORT_TTL_MS)
  assert.equal(HELICOPTER_TTL_MS, 15 * 60 * 1000)
})

test('a 16-minute-old helicopter sighting is gone while a unit of the same age stays', () => {
  const ago = 16 * 60 * 1000
  const out = computeCommunityReports(
    [
      report(1, { kind: 'helicopter', agoMs: ago, authoritative: true }),
      report(2, { kind: 'helicopter', lat: -37.9, lng: 145.2, agoMs: ago, authoritative: true }),
      report(3, { kind: 'marked', lat: -37.8, lng: 145.0, agoMs: ago, sessionId: 'a' }),
      report(4, { kind: 'marked', lat: -37.8, lng: 145.0, agoMs: ago, sessionId: 'b' }),
      report(5, { kind: 'marked', lat: -37.8, lng: 145.0, agoMs: ago, sessionId: 'c' }),
    ],
    NOW
  )
  assert.equal(out.filter((r) => r.kind === 'helicopter').length, 0, 'helicopter expired')
  assert.equal(out.filter((r) => r.kind === 'marked').length, 1, 'ground unit survived')
})

// ── the privilege, and its limits ───────────────────────────────────────────

test('one privileged report publishes on its own, without corroboration', () => {
  const out = computeCommunityReports([report(1, { authoritative: true })], NOW)
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'helicopter')
  assert.equal(out[0].reportCount, 1)
  assert.equal(out[0].authoritative, true)
})

test('the SAME report without the flag stays hidden', () => {
  // This is the test that stops the privilege from leaking to the kind. If it ever
  // fails, an anonymous POST with kind='helicopter' is broadcasting to everyone.
  const out = computeCommunityReports([report(1)], NOW)
  assert.equal(out.length, 0)
})

test('an unprivileged helicopter still needs three distinct reporters', () => {
  const one = computeCommunityReports([report(1)], NOW)
  assert.equal(one.length, 0)

  const three = computeCommunityReports(
    [report(1, { sessionId: 'a' }), report(2, { sessionId: 'b' }), report(3, { sessionId: 'c' })],
    NOW
  )
  assert.equal(three.length, 1)
  assert.equal(three[0].authoritative, false)

  // ...and three reports from ONE session are still one reporter.
  const self = computeCommunityReports(
    [report(1, { sessionId: 'x' }), report(2, { sessionId: 'x' }), report(3, { sessionId: 'x' })],
    NOW
  )
  assert.equal(self.length, 0)
})

test('the ordinary rule is untouched: three distinct reporters confirm a unit', () => {
  const out = computeCommunityReports(
    [
      report(1, { kind: 'marked', sessionId: 'a' }),
      report(2, { kind: 'marked', sessionId: 'b' }),
      report(3, { kind: 'marked', sessionId: 'c' }),
    ],
    NOW
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'marked')
  assert.equal(out[0].reportCount, CONFIRM_COUNT)
  assert.equal(out[0].authoritative, false)
})

// ── honesty about the placement ─────────────────────────────────────────────

test('the sighting carries how coarse its placement was, and keeps the worst of them', () => {
  const out = computeCommunityReports(
    [
      report(1, { authoritative: true, accuracyM: 4000 }),
      report(2, { authoritative: true, accuracyM: 21000 }),
    ],
    NOW
  )
  assert.equal(out.length, 1)
  // Two placements of the same sighting: the published error is the larger one, because
  // the map must not imply the better of two positions it does not have.
  assert.equal(out[0].accuracyM, 21000)
})

test('a sighting with no stated accuracy reports none, rather than zero', () => {
  const out = computeCommunityReports([report(1, { authoritative: true })], NOW)
  assert.equal(out[0].accuracyM, undefined)
})
