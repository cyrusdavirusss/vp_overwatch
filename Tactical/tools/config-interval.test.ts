// Credit-budget-aware poll interval + Melbourne-bbox credit costing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  openSkyBudgetIntervalSeconds, restIntervalSeconds, openSkyCreditsPerCall,
  openSkyBbox, bboxAreaSqDeg, creditsForArea, MELBOURNE_BBOX,
} from '../lib/adsb/config.ts'

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const keys = ['ADSB_PROVIDER','ADSB_REST_INTERVAL_SECONDS','OPENSKY_CLIENT_ID','OPENSKY_CLIENT_SECRET','OPENSKY_USERNAME','OPENSKY_PASSWORD','OPENSKY_DAILY_CREDITS','OPENSKY_CREDITS_PER_CALL','OPENSKY_BBOX']
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k] }
  for (const k of Object.keys(env)) { if (env[k] !== undefined) process.env[k] = env[k]! }
  try { fn() } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

test('Melbourne is the default bbox and costs 1 credit/call', () => {
  withEnv({}, () => {
    assert.deepEqual(openSkyBbox(), MELBOURNE_BBOX)
    assert.ok(bboxAreaSqDeg(MELBOURNE_BBOX) <= 25)
    assert.equal(openSkyCreditsPerCall(), 1)
  })
})

test('creditsForArea bands', () => {
  assert.equal(creditsForArea(2), 1)
  assert.equal(creditsForArea(50), 2)
  assert.equal(creditsForArea(300), 3)
  assert.equal(creditsForArea(9999), 4)
})

test('OPENSKY_BBOX=global → whole-world query = 4 credits/call', () => {
  withEnv({ OPENSKY_BBOX: 'global' }, () => {
    assert.equal(openSkyBbox(), null)
    assert.equal(openSkyCreditsPerCall(), 4)
  })
})

test('anonymous: Melbourne(1cr)=216s; global(4cr)=864s', () => {
  withEnv({ ADSB_PROVIDER: 'opensky' }, () => assert.equal(restIntervalSeconds(), 216))          // 86400*1/400
  withEnv({ ADSB_PROVIDER: 'opensky', OPENSKY_BBOX: 'global' }, () => assert.equal(restIntervalSeconds(), 864)) // 86400*4/400
})

test('authenticated (OAuth2 or basic): Melbourne(1cr)=22s; global(4cr)=87s', () => {
  withEnv({ ADSB_PROVIDER: 'opensky', OPENSKY_CLIENT_ID: 'a', OPENSKY_CLIENT_SECRET: 'b' }, () =>
    assert.equal(restIntervalSeconds(), 22))                                                     // 86400*1/4000
  withEnv({ ADSB_PROVIDER: 'opensky', OPENSKY_USERNAME: 'u', OPENSKY_PASSWORD: 'p' }, () =>
    assert.equal(restIntervalSeconds(), 22))                                                     // basic auth also = authed
  withEnv({ ADSB_PROVIDER: 'opensky', OPENSKY_CLIENT_ID: 'a', OPENSKY_CLIENT_SECRET: 'b', OPENSKY_BBOX: 'global' }, () =>
    assert.equal(restIntervalSeconds(), 87))                                                     // 86400*4/4000
})

test('explicit ADSB_REST_INTERVAL_SECONDS always wins', () => {
  withEnv({ ADSB_PROVIDER: 'opensky', ADSB_REST_INTERVAL_SECONDS: '45' }, () => assert.equal(restIntervalSeconds(), 45))
})
