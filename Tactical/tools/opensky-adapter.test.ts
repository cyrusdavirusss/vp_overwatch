// OpenSky adapter normalization tests (SI→internal units, seen_pos as duration).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeState, parseStates } from '../lib/adsb/opensky-adapter.ts'

const SNAP = 1_788_614_166
// [icao24,callsign,country,time_pos,last_contact,lon,lat,baro_m,on_ground,vel_ms,track,vrate_ms,sensors,geo_m,squawk,spi,src,cat]
const AIRBORNE = ['7c76c4', 'TMN8    ', 'Australia', 1_788_614_165, 1_788_614_164, 144.8294, -37.6262, 685.8, false, 90.33, 350.16, 2.5, null, 700, '1234', false, 0, 0]
const GROUND = ['7c78ad', 'QLK1259', 'Australia', 1_788_614_160, 1_788_614_160, 144.8516, -37.6673, null, true, 0, 81.56, null, null, null, null, false, 0, 0]

test('normalizeState: metres→feet, m/s→knots, m/s→fpm', () => {
  const a = normalizeState(AIRBORNE, SNAP)
  assert.equal(a.icao24, '7c76c4')
  assert.equal(a.callsign, 'TMN8')                       // trimmed
  assert.ok(Math.abs(a.altitudeBaro! - 685.8 * 3.280839895) < 0.01)   // ~2249.9 ft
  assert.ok(Math.abs(a.groundSpeed! - 90.33 * 1.943844492) < 0.01)    // ~175.6 kt
  assert.ok(Math.abs(a.verticalRate! - 2.5 * 196.8503937) < 0.01)     // ~492 fpm
  assert.equal(a.onGround, false)
  assert.equal(a.registration, null)                     // states/all has no reg
})

test('normalizeState: seen_pos is a DURATION = time − time_position', () => {
  assert.equal(normalizeState(AIRBORNE, SNAP).seenPos, 1)  // 166 − 165
  assert.equal(normalizeState(GROUND, SNAP).seenPos, 6)    // 166 − 160
})

test('normalizeState: on-ground with null baro → onGround true, altitude null', () => {
  const g = normalizeState(GROUND, SNAP)
  assert.equal(g.onGround, true)
  assert.equal(g.altitudeBaro, null)   // not a false 0
  assert.equal(g.groundSpeed, 0)       // real 0 m/s preserved
})

test('parseStates: keyed by hex, providerNow = time*1000', () => {
  const { aircraft, providerNow } = parseStates({ time: SNAP, states: [AIRBORNE, GROUND, 'bad', null] })
  assert.equal(aircraft.size, 2)
  assert.ok(aircraft.has('7c76c4') && aircraft.has('7c78ad'))
  assert.equal(providerNow, SNAP * 1000)
})

test('parseStates: empty/absent states → empty map', () => {
  assert.equal(parseStates({ time: SNAP }).aircraft.size, 0)
  assert.equal(parseStates({}).providerNow, null)
})
