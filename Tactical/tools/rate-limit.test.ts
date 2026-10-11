// Tests for rate limiting + IP-trust gating (F1). Run via node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rateLimit, rateLimitIp, clientIp, accountKey } from '../lib/auth/rate-limit.ts'

test('rateLimit blocks after limit within the window', () => {
  const k = `t:${Math.random()}`
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(k, 3, 60).allowed, true)
  const blocked = rateLimit(k, 3, 60)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSec > 0)
})

test('clientIp ignores spoofable XFF unless TRUSTED_PROXY=true', () => {
  const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' })
  delete process.env.TRUSTED_PROXY
  assert.equal(clientIp(h), 'untrusted') // spoof-proof default: header not trusted
  process.env.TRUSTED_PROXY = 'true'
  assert.equal(clientIp(h), '5.6.7.8')   // right-most hop = proxy-attached
  delete process.env.TRUSTED_PROXY
})

test('accountKey normalizes email for per-account throttle', () => {
  assert.equal(accountKey('  Foo@Bar.CO '), 'foo@bar.co')
  assert.equal(accountKey(undefined), 'unknown')
})

test('rateLimitIp: untrusted IP is never globally throttled (N1)', () => {
  // Unidentifiable client → always allowed (per-account limit is the real guard).
  for (let i = 0; i < 100; i++) assert.equal(rateLimitIp('untrusted', 'login', 5, 900).allowed, true)
  // A real IP is enforced normally.
  const ip = `9.9.9.${Math.floor(Math.random()*255)}`
  for (let i = 0; i < 3; i++) assert.equal(rateLimitIp(ip, 'login', 3, 900).allowed, true)
  assert.equal(rateLimitIp(ip, 'login', 3, 900).allowed, false)
})
