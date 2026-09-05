// Credit-budget-aware poll interval (OpenSky anonymous = exactly 400 credits/day).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openSkyBudgetIntervalSeconds, restIntervalSeconds } from '../lib/adsb/config.ts'

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k] }
  try { fn() } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

test('openSkyBudgetIntervalSeconds: 400 credits/day, 4 credits/call → 864s', () => {
  withEnv({ OPENSKY_DAILY_CREDITS: undefined, OPENSKY_CREDITS_PER_CALL: undefined }, () => {
    const s = openSkyBudgetIntervalSeconds()
    assert.equal(s, 864)
    assert.equal(Math.floor(86400 / s) * 4, 400) // exactly the daily budget
  })
})

test('budget interval respects env overrides', () => {
  withEnv({ OPENSKY_DAILY_CREDITS: '4000', OPENSKY_CREDITS_PER_CALL: '4' }, () => {
    assert.equal(openSkyBudgetIntervalSeconds(), 87) // 86400*4/4000 = 86.4 → 87
  })
})

test('restIntervalSeconds: anon OpenSky paces to budget; authed/explicit differ', () => {
  withEnv({ ADSB_PROVIDER: 'opensky', ADSB_REST_INTERVAL_SECONDS: undefined, OPENSKY_CLIENT_ID: undefined, OPENSKY_CLIENT_SECRET: undefined }, () => {
    assert.equal(restIntervalSeconds(), 864) // anonymous → budget-paced
  })
  withEnv({ ADSB_PROVIDER: 'opensky', ADSB_REST_INTERVAL_SECONDS: undefined, OPENSKY_CLIENT_ID: 'a', OPENSKY_CLIENT_SECRET: 'b' }, () => {
    assert.equal(restIntervalSeconds(), 30) // authenticated → 30s
  })
  withEnv({ ADSB_PROVIDER: 'opensky', ADSB_REST_INTERVAL_SECONDS: '120' }, () => {
    assert.equal(restIntervalSeconds(), 120) // explicit wins
  })
})
