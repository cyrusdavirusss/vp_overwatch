// Unit tests for the ADS-B Exchange v2 adapter. Pure/fixture-based — no live
// provider. Run: node --experimental-strip-types --test tools/adsb-adapter.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ADSBExchangeAdapter,
  normalizeAircraft,
  parseCollection,
  parseNumeric,
  ProviderError,
} from '../lib/adsb/exchange-adapter.ts'

// A realistic v2 gateway collection body: aircraft live under `ac`, fields are
// hex/r/flight/alt_baro/gs/track/baro_rate/lat/lon/seen_pos/seen, plus `now`.
const V2_BODY = {
  now: 1_725_500_000_000,
  ac: [
    {
      hex: '7c6db8', r: 'VH-PVO', flight: 'POL21 ', alt_baro: 2300, alt_geom: 2450,
      gs: 118, track: 271.4, baro_rate: -64, lat: -37.81, lon: 144.96,
      seen_pos: 2.1, seen: 0.4, squawk: '3000', emergency: 'none',
    },
    { hex: '7c6db9', r: 'VH-PVE', flight: 'PVE1', alt_baro: 'ground', gs: 0, lat: -37.67, lon: 144.84, seen_pos: 5, seen: 1 },
    { hex: '7c6dba', r: 'VH-PVQ', flight: '', lat: -37.9, lon: 145.0, seen_pos: 340, seen: 340 }, // no alt/gs/track
  ],
}

test('parseNumeric: absent/invalid → null, never 0', () => {
  assert.equal(parseNumeric(undefined), null)
  assert.equal(parseNumeric(null), null)
  assert.equal(parseNumeric(''), null)
  assert.equal(parseNumeric('nope'), null)
  assert.equal(parseNumeric(0), 0)
  assert.equal(parseNumeric('118'), 118)
})

test('normalizeAircraft: hex→icao24, r→registration, flight→callsign', () => {
  const ac = normalizeAircraft(V2_BODY.ac[0])
  assert.equal(ac.icao24, '7c6db8')
  assert.equal(ac.registration, 'VH-PVO')
  assert.equal(ac.callsign, 'POL21') // trimmed
  assert.equal(ac.altitudeBaro, 2300)
  assert.equal(ac.groundSpeed, 118)
  assert.equal(ac.track, 271.4)
  assert.equal(ac.verticalRate, -64)
  assert.equal(ac.onGround, false)
})

test('normalizeAircraft: alt_baro "ground" → onGround true, altitude null (not 0)', () => {
  const ac = normalizeAircraft(V2_BODY.ac[1])
  assert.equal(ac.onGround, true)
  assert.equal(ac.altitudeBaro, null) // must NOT be coerced to 0 ft
})

test('normalizeAircraft: missing telemetry stays null, never a false zero', () => {
  const ac = normalizeAircraft(V2_BODY.ac[2])
  assert.equal(ac.altitudeBaro, null)
  assert.equal(ac.groundSpeed, null)
  assert.equal(ac.track, null)
  assert.equal(ac.verticalRate, null)
  assert.equal(ac.callsign, null)
  // seen_pos is a DURATION and must be preserved verbatim (not a timestamp)
  assert.equal(ac.seenPos, 340)
})

test('parseCollection: reads `ac` array keyed by hex, normalizes `now` to ms', () => {
  const { aircraft, providerNow } = parseCollection(V2_BODY)
  assert.equal(aircraft.size, 3)
  assert.ok(aircraft.has('7c6db8'))
  assert.equal(providerNow, 1_725_500_000_000)
  // seconds-form `now` is scaled to ms
  assert.equal(parseCollection({ now: 1_725_500_000, ac: [] }).providerNow, 1_725_500_000_000)
})

test('parseCollection: ignores a top-level `aircraft` field (the old wrong shape)', () => {
  const { aircraft } = parseCollection({ aircraft: [{ hex: 'deadbe', r: 'X' }] })
  assert.equal(aircraft.size, 0)
})

// ── Adapter request shaping (fake fetch, no network) ────────────────────────

function fakeFetch(record: { url?: string; init?: any }, body: unknown, status = 200): typeof fetch {
  return (async (url: any, init: any) => {
    record.url = String(url)
    record.init = init
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'x',
      headers: { get: () => null },
      json: async () => body,
    } as any
  }) as unknown as typeof fetch
}

test('fetchByIcaos: correct v2 path, X-Api-Key + gzip headers, no Bearer', async () => {
  const rec: any = {}
  const adapter = new ADSBExchangeAdapter('secret-key', { fetchImpl: fakeFetch(rec, V2_BODY) })
  const { aircraft } = await adapter.fetchByIcaos(['7C6DB8', '7c6db9'])
  assert.equal(aircraft.size, 3)
  assert.ok(rec.url.endsWith('/api/aircraft/v2/icao/7c6db8%2C7c6db9'), rec.url)
  assert.equal(rec.init.headers['X-Api-Key'], 'secret-key')
  assert.equal(rec.init.headers['Accept-Encoding'], 'gzip')
  assert.equal(rec.init.headers['Authorization'], undefined)
})

test('resolveRegistration: verified only on exact `r` match', async () => {
  const rec: any = {}
  const ok = new ADSBExchangeAdapter('k', { fetchImpl: fakeFetch(rec, { ac: [{ hex: '7c6db8', r: 'vh-pvo' }] }) })
  const good = await ok.resolveRegistration('VH-PVO')
  assert.equal(good.verified, true)
  assert.equal(good.status, 'verified')
  assert.equal(good.icao24, '7c6db8')
  assert.ok(rec.url.endsWith('/registration/VH-PVO'), rec.url)

  const mismatch = new ADSBExchangeAdapter('k', { fetchImpl: fakeFetch({}, { ac: [{ hex: 'aaa', r: 'VH-XXX' }] }) })
  const bad = await mismatch.resolveRegistration('VH-PVO')
  assert.equal(bad.verified, false)
  assert.equal(bad.status, 'unresolved')
  assert.equal(bad.icao24, '')
})

test('auth failure (403) does not retry and surfaces classified ProviderError', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    return { ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => null }, json: async () => ({}) } as any
  }) as unknown as typeof fetch
  const adapter = new ADSBExchangeAdapter('k', { fetchImpl, maxRetries: 3 })
  await assert.rejects(
    () => adapter.fetchByIcaos(['7c6db8']),
    (e: unknown) => e instanceof ProviderError && e.errorClass === 'authentication_failure',
  )
  assert.equal(calls, 1, 'auth failures must not be retried')
  assert.equal(adapter.getHealth().status, 'degraded')
})

test('circuit breaker opens after threshold consecutive failures', async () => {
  let t = 0
  const fetchImpl = (async () => ({ ok: false, status: 500, statusText: 'err', headers: { get: () => null }, json: async () => ({}) })) as unknown as typeof fetch
  const adapter = new ADSBExchangeAdapter('k', {
    fetchImpl, maxRetries: 0, circuitThreshold: 3, circuitCooldownMs: 10_000, now: () => (t += 1),
  })
  for (let i = 0; i < 3; i++) await assert.rejects(() => adapter.fetchByIcaos(['7c6db8']))
  // Next call should short-circuit without hitting fetch.
  await assert.rejects(
    () => adapter.fetchByIcaos(['7c6db8']),
    (e: unknown) => e instanceof ProviderError && e.errorClass === 'circuit_open',
  )
  assert.equal(adapter.getHealth().status, 'unavailable')
})

test('getHealth() does not mutate breaker state (F5 — pure read)', async () => {
  let t = 0
  const fetchImpl = (async () => ({ ok: false, status: 500, statusText: 'err', headers: { get: () => null }, json: async () => ({}) })) as unknown as typeof fetch
  const adapter = new ADSBExchangeAdapter('k', { fetchImpl, maxRetries: 0, circuitThreshold: 2, circuitCooldownMs: 100, now: () => t })
  for (let i = 0; i < 2; i++) await assert.rejects(() => adapter.fetchByIcaos(['7c6db8']))
  assert.equal(adapter.getHealth().circuitOpen, true)
  // Advance the clock past cooldown; a pure health READ must NOT flip it half-open.
  t = 100000
  assert.equal(adapter.getHealth().circuitOpen, false) // computed open-ness only
  assert.equal(adapter.getHealth().circuitOpen, false) // still no side effect on repeat
})
