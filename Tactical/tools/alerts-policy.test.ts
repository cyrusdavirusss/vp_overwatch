// Unit tests for the alert dispatch policy and the signed alert tokens.
// Run: node --experimental-strip-types --test tools/alerts-policy.test.ts
//
// The properties that matter here are the ones a person feels: that quiet hours
// actually hold, that they hold across MIDNIGHT (the case naive implementations
// get wrong, muting alerting during the day instead of the night), that they are
// evaluated in the subscriber's own zone and not the server's, that they never
// silence a non-intrusive channel, and that an urgent event can still get through.
// Plus the token rules, because a link that mints someone else's unsubscription
// is a forgery, not a convenience.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inQuietHours,
  localHour,
  mayDispatchNow,
  INTRUSIVE_CHANNELS,
} from '../lib/alerts/policy.ts'
import { mintToken, verifyToken, unsubscribeUrl } from '../lib/alerts/tokens.ts'

// 2026-01-15T13:00:00Z — Melbourne is on AEDT (+11) in January, so this is 00:00.
const JAN_13Z = Date.UTC(2026, 0, 15, 13, 0, 0)
// 2026-07-15T13:00:00Z — Melbourne is on AEST (+10) in July, so this is 23:00.
const JUL_13Z = Date.UTC(2026, 6, 15, 13, 0, 0)

test('localHour reads the wall clock in the subscriber zone, not the server zone', () => {
  assert.equal(localHour(JAN_13Z, 'Australia/Melbourne'), 0, '13:00Z in January is midnight in Melbourne (AEDT)')
  assert.equal(localHour(JUL_13Z, 'Australia/Melbourne'), 23, '13:00Z in July is 11pm in Melbourne (AEST)')
  assert.equal(localHour(JAN_13Z, 'UTC'), 13)
  // A zone the runtime does not know must not throw — it falls back to UTC.
  assert.equal(localHour(JAN_13Z, 'Not/AZone'), 13)
})

test('quiet hours hold across midnight (22:00 to 07:00)', () => {
  const quiet = { startHour: 22, endHour: 7, timezone: 'Australia/Melbourne' }
  const at = (h: number, day = 15) => Date.UTC(2026, 0, day, h - 11, 0, 0) // AEDT: local h = UTC h-11

  assert.equal(inQuietHours(at(23), quiet), true, '11pm is inside')
  assert.equal(inQuietHours(at(2), quiet), true, '2am is inside')
  assert.equal(inQuietHours(at(6), quiet), true, '6am is inside')
  assert.equal(inQuietHours(at(7), quiet), false, '7am is outside (end is exclusive)')
  assert.equal(inQuietHours(at(12), quiet), false, 'midday is outside')
  assert.equal(inQuietHours(at(21), quiet), false, '9pm is outside')
})

test('a same-day window still works, and an empty window does not mute anyone', () => {
  const daytime = { startHour: 9, endHour: 17, timezone: 'Australia/Melbourne' }
  const at = (h: number) => Date.UTC(2026, 0, 15, h - 11, 0, 0)
  assert.equal(inQuietHours(at(10), daytime), true)
  assert.equal(inQuietHours(at(18), daytime), false)

  // start === end is an empty window, not a 24-hour one. Dragging the sliders
  // together must not silence a person forever.
  assert.equal(inQuietHours(at(10), { startHour: 5, endHour: 5, timezone: 'Australia/Melbourne' }), false)

  // No window configured at all.
  assert.equal(inQuietHours(at(3), null), false)
  assert.equal(inQuietHours(at(3), { startHour: null, endHour: 7 }), false)
})

test('quiet hours apply in the subscriber clock, at the same instant', () => {
  const quiet = { startHour: 0, endHour: 8, timezone: 'Australia/Melbourne' }
  // 13:00Z in January is midnight in Melbourne — inside the window there.
  assert.equal(inQuietHours(JAN_13Z, quiet), true)
  // The same instant expressed for a UTC-anchored subscriber is 1pm, outside it.
  assert.equal(inQuietHours(JAN_13Z, { ...quiet, timezone: 'UTC' }), false)
})

test('quiet hours never silence a non-intrusive channel', () => {
  const quiet = { startHour: 0, endHour: 23, timezone: 'Australia/Melbourne' }
  for (const channel of ['push', 'email', 'inapp']) {
    const d = mayDispatchNow(channel, { nowMs: JAN_13Z, quiet })
    assert.equal(d.allowed, true, `${channel} must never be held by quiet hours`)
  }
  assert.deepEqual([...INTRUSIVE_CHANNELS], ['sms', 'call'])
})

test('intrusive channels are held during quiet hours, and say why', () => {
  const quiet = { startHour: 22, endHour: 7, timezone: 'Australia/Melbourne' }
  const inWindow = Date.UTC(2026, 0, 15, 13, 0, 0) // midnight in Melbourne
  for (const channel of ['sms', 'call']) {
    const d = mayDispatchNow(channel, { nowMs: inWindow, quiet })
    assert.equal(d.allowed, false, `${channel} should be held at midnight`)
    assert.match(d.reason, /quiet hours/, 'the ledger needs a reason that reads as one')
  }
})

test('an urgent event crosses quiet hours while the bypass is on', () => {
  const quiet = { startHour: 22, endHour: 7, timezone: 'Australia/Melbourne', urgentBypass: true }
  const midnight = Date.UTC(2026, 0, 15, 13, 0, 0)
  assert.equal(mayDispatchNow('call', { nowMs: midnight, quiet, urgent: true }).allowed, true)
  assert.equal(mayDispatchNow('call', { nowMs: midnight, quiet, urgent: false }).allowed, false)
})

test('a subscriber who turns the bypass off is never woken', () => {
  const quiet = { startHour: 22, endHour: 7, timezone: 'Australia/Melbourne', urgentBypass: false }
  const midnight = Date.UTC(2026, 0, 15, 13, 0, 0)
  assert.equal(mayDispatchNow('call', { nowMs: midnight, quiet, urgent: true }).allowed, false)
  // Outside the window it still goes.
  assert.equal(mayDispatchNow('call', { nowMs: Date.UTC(2026, 0, 15, 3, 0, 0), quiet, urgent: true }).allowed, true)
})

test('tokens round-trip and carry their purpose', () => {
  const original = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = 'test-secret-value-long-enough'
  try {
    const t = mintToken(41, 'unsubscribe', 3600_000, 1_000_000)
    assert.ok(t, 'a token is minted when a secret exists')
    const ok = verifyToken(t, 'unsubscribe', 1_000_001)
    assert.equal(ok.ok, true)
    assert.equal(ok.ok && ok.userId, 41)

    // Purpose-scoped: a token minted to unsubscribe cannot verify as anything else.
    assert.equal(verifyToken(t, 'verify-sms', 1_000_001).ok, false)

    // Expiry.
    assert.equal(verifyToken(t, 'unsubscribe', 1_000_000 + 3600_001).ok, false)

    // Tampering with the payload must not survive the signature.
    const [payload, sig] = t!.split('.')
    const forgedPayload = Buffer.from(`999.unsubscribe.${1_000_000 + 3600_000}`).toString('base64url')
    assert.equal(verifyToken(`${forgedPayload}.${sig}`, 'unsubscribe', 1_000_001).ok, false)
    assert.equal(verifyToken(`${payload}.AAAA${sig.slice(4)}`, 'unsubscribe', 1_000_001).ok, false)

    // Rubbish in, refusal out — never a throw.
    assert.equal(verifyToken('', 'unsubscribe', 1_000_001).ok, false)
    assert.equal(verifyToken('not-a-token', 'unsubscribe', 1_000_001).ok, false)
    assert.equal(verifyToken(null, 'unsubscribe', 1_000_001).ok, false)
  } finally {
    if (original === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = original
  }
})

test('with no signing secret nothing mints and nothing verifies (fail closed)', () => {
  const original = process.env.AUTH_SECRET
  delete process.env.AUTH_SECRET
  try {
    assert.equal(mintToken(1, 'unsubscribe'), null)
    const check = verifyToken('anything.anything', 'unsubscribe')
    assert.equal(check.ok, false)
    assert.match(check.ok === false ? check.reason : '', /fail closed/)
  } finally {
    if (original !== undefined) process.env.AUTH_SECRET = original
  }
})

test('the unsubscribe URL only exists when the deployment can build a usable one', () => {
  const originalSecret = process.env.AUTH_SECRET
  const originalUrl = process.env.ALERT_PUBLIC_URL
  process.env.AUTH_SECRET = 'test-secret-value-long-enough'
  try {
    delete process.env.ALERT_PUBLIC_URL
    assert.equal(unsubscribeUrl(7), null, 'no public URL means no link, so email stays disabled')

    process.env.ALERT_PUBLIC_URL = 'https://example.com/'
    const u = unsubscribeUrl(7)
    assert.ok(u && u.startsWith('https://example.com/api/alerts/unsubscribe?token='), `got ${u}`)
    const token = decodeURIComponent(u!.split('token=')[1])
    const check = verifyToken(token, 'unsubscribe')
    assert.equal(check.ok, true)
    assert.equal(check.ok && check.userId, 7)
  } finally {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalSecret
    if (originalUrl === undefined) delete process.env.ALERT_PUBLIC_URL
    else process.env.ALERT_PUBLIC_URL = originalUrl
  }
})
