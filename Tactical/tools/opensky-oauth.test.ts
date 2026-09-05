// OpenSky OAuth2 client-credentials flow (mocked; no network, no real creds).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenSkyAdapter } from '../lib/adsb/opensky-adapter.ts'

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: 'x', headers: { get: () => null }, json: async () => body } as any
}
const STATES = { time: 1_788_614_166, states: [['7c4ef2', 'POL30', 'AU', 1_788_614_165, 1_788_614_165, 144.9, -37.72, 200, false, 40, 90, 0, null, 210, '1234', false, 0, 0]] }

test('OAuth2: fetches a client-credentials token and sends Bearer; caches it', async () => {
  const calls: any[] = []
  let tokenHits = 0
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/token')) { tokenHits++; return resp(200, { access_token: 'tok1', expires_in: 1800 }) }
    return resp(200, STATES)
  }) as unknown as typeof fetch
  const a = new OpenSkyAdapter({ clientId: 'cid', clientSecret: 'csec', fetchImpl })

  const r1 = await a.fetchByIcaos(['7c4ef2'])
  assert.equal(r1.aircraft.size, 1)
  const tokenCall = calls.find((c) => c.url.includes('/token'))
  assert.ok(tokenCall, 'token endpoint called')
  assert.match(tokenCall.init.body, /grant_type=client_credentials/)
  assert.match(tokenCall.init.body, /client_id=cid/)
  const statesCall = calls.find((c) => c.url.includes('/states/all'))
  assert.equal(statesCall.init.headers['Authorization'], 'Bearer tok1')

  await a.fetchByIcaos(['7c4ef2'])           // second call
  assert.equal(tokenHits, 1, 'token is cached, not re-fetched each call')
})

test('OAuth2: a 401 refreshes the token once and retries', async () => {
  let tokenHits = 0, statesHits = 0
  const fetchImpl = (async (url: any, init: any) => {
    if (String(url).includes('/token')) { tokenHits++; return resp(200, { access_token: `tok${tokenHits}`, expires_in: 1800 }) }
    statesHits++
    return statesHits === 1 ? resp(401, {}) : resp(200, STATES) // first states call: stale token
  }) as unknown as typeof fetch
  const a = new OpenSkyAdapter({ clientId: 'cid', clientSecret: 'csec', fetchImpl, maxRetries: 2 })
  const r = await a.fetchByIcaos(['7c4ef2'])
  assert.equal(r.aircraft.size, 1)
  assert.equal(tokenHits, 2, 'token re-minted after 401')
  assert.equal(statesHits, 2, 'states retried after refresh')
})

test('anonymous (no creds): no token call, no Authorization header', async () => {
  const calls: any[] = []
  const fetchImpl = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return resp(200, STATES) }) as unknown as typeof fetch
  const a = new OpenSkyAdapter({ fetchImpl })
  await a.fetchByIcaos(['7c4ef2'])
  assert.ok(!calls.some((c) => c.url.includes('/token')), 'no token endpoint hit')
  assert.equal(calls[0].init.headers['Authorization'], undefined)
})

test('basic-auth fallback: sends Authorization: Basic, no token endpoint', async () => {
  const calls: any[] = []
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return { ok: true, status: 200, statusText: 'ok', headers: { get: () => null }, json: async () => STATES } as any
  }) as unknown as typeof fetch
  const a = new OpenSkyAdapter({ username: 'joe', password: 'pw', fetchImpl })
  await a.fetchByIcaos(['7c4ef2'])
  assert.ok(!calls.some((c) => c.url.includes('/token')), 'no OAuth2 token call for basic auth')
  const auth = calls[0].init.headers['Authorization']
  assert.equal(auth, 'Basic ' + Buffer.from('joe:pw').toString('base64'))
})

test('bbox mode: queries the box once and filters to the requested hexes', async () => {
  const many = { time: 1_788_614_166, states: [
    ['7c4ef2', 'POL30', 'AU', 1_788_614_165, 1_788_614_165, 144.9, -37.72, 200, false, 40, 90, 0, null, 210, '1', false, 0, 0],
    ['abc123', 'OTHER', 'AU', 1_788_614_165, 1_788_614_165, 145.0, -37.80, 300, false, 50, 90, 0, null, 310, '2', false, 0, 0],
  ] }
  let url = ''
  const fetchImpl = (async (u: any) => { url = String(u); return { ok: true, status: 200, statusText: 'ok', headers: { get: () => null }, json: async () => many } as any }) as unknown as typeof fetch
  const a = new OpenSkyAdapter({ bbox: { lamin: -38.6, lomin: 144.0, lamax: -37.2, lomax: 145.8 }, fetchImpl })
  const r = await a.fetchByIcaos(['7c4ef2'])
  assert.match(url, /lamin=-38.6.*lomin=144.*lamax=-37.2.*lomax=145.8/)  // bbox query, not icao24
  assert.equal(r.aircraft.size, 1)             // filtered down to the tracked hex
  assert.ok(r.aircraft.has('7c4ef2') && !r.aircraft.has('abc123'))
})
