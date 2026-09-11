// Pure row↔record mapping tests (no DB).
// Run: node --experimental-strip-types --test tools/adsb-persistence.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowToRecord, recordToParams, type AircraftStateRow } from '../lib/adsb/persistence/mapping.ts'
import { emptyRecord } from '../lib/adsb/state-machine.ts'

const ROW: AircraftStateRow = {
  registration: 'VH-PVO', description: 'AW139', icao24: '7c6db8', mapping_status: 'verified',
  state: 'live_airborne', data_status: 'live', last_observed_at: '2026-09-05T00:00:00.000Z',
  latitude: -37.8, longitude: 144.9, altitude_metres: 304.8, ground_speed_kt: 118, track_degrees: 271,
  vertical_rate_fpm: -64, on_ground: false, seen_pos_seconds: 2.1, seen_seconds: 0.4,
  is_position_usable: true, confirmed_movement: 'airborne', candidate_movement: 'airborne',
  candidate_count: 3, airborne_episode_seq: '4', not_seen_seq: '1',
  last_provider_contact_at: '2026-09-05T00:00:01.000Z', event_version: '99',
  updated_at: '2026-09-05T00:00:01.000Z',
}

test('rowToRecord: types, bigint strings→numbers, timestamps→ms', () => {
  const r = rowToRecord(ROW)
  assert.equal(r.registration, 'VH-PVO')
  assert.equal(r.airborneEpisodeSeq, 4)
  assert.equal(r.notSeenSeq, 1)
  assert.equal(r.eventVersion, 99)
  assert.equal(r.lastObservedAt, Date.parse('2026-09-05T00:00:00.000Z'))
  assert.equal(r.altitudeMetres, 304.8)
})

test('rowToRecord: NULL telemetry stays null (no false zeros)', () => {
  const r = rowToRecord({ ...ROW, altitude_metres: null, ground_speed_kt: null, on_ground: null, last_observed_at: null })
  assert.equal(r.altitudeMetres, null)
  assert.equal(r.groundSpeedKt, null)
  assert.equal(r.onGround, null)
  assert.equal(r.lastObservedAt, null)
})

test('recordToParams: 24 positional params, nulls preserved', () => {
  const rec = emptyRecord('VH-PVO', 'AW139', Date.parse('2026-09-05T00:00:00Z'))
  const p = recordToParams(rec)
  assert.equal(p.length, 24)
  assert.equal(p[0], 'VH-PVO')
  assert.equal(p[1], null)       // icao24 null
  assert.equal(p[8], null)       // altitude_metres null
})

test('round-trip: row→record→params keeps identity fields', () => {
  const rec = rowToRecord(ROW)
  const p = recordToParams(rec)
  assert.equal(p[0], 'VH-PVO')
  assert.equal(p[1], '7c6db8')
  assert.equal(p[19], 4)         // airborne_episode_seq
})
