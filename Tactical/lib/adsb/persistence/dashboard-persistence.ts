/**
 * PostgreSQL persistence for the ADS-B dashboard. Source of truth. Uses the
 * shared pool; pure mapping lives in ./mapping.ts.
 */
import { query, withClient } from '../../db/pool.ts'
import { rowToRecord, recordToParams, type AircraftStateRow } from './mapping.ts'
import type { TrackedAircraftDef } from '../config.ts'
import type { AircraftEvent, AircraftRecord, MappingStatus } from '../types.ts'
import { emptyRecord } from '../state-machine.ts'

const UPSERT_STATE = `
INSERT INTO aircraft_current_state (
  registration, icao24, mapping_status, state, data_status, last_observed_at,
  latitude, longitude, altitude_metres, ground_speed_kt, track_degrees,
  vertical_rate_fpm, on_ground, seen_pos_seconds, seen_seconds, is_position_usable,
  confirmed_movement, candidate_movement, candidate_count, airborne_episode_seq,
  not_seen_seq, last_provider_contact_at, event_version, updated_at
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
)
ON CONFLICT (registration) DO UPDATE SET
  icao24=EXCLUDED.icao24, mapping_status=EXCLUDED.mapping_status, state=EXCLUDED.state,
  data_status=EXCLUDED.data_status, last_observed_at=EXCLUDED.last_observed_at,
  latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, altitude_metres=EXCLUDED.altitude_metres,
  ground_speed_kt=EXCLUDED.ground_speed_kt, track_degrees=EXCLUDED.track_degrees,
  vertical_rate_fpm=EXCLUDED.vertical_rate_fpm, on_ground=EXCLUDED.on_ground,
  seen_pos_seconds=EXCLUDED.seen_pos_seconds, seen_seconds=EXCLUDED.seen_seconds,
  is_position_usable=EXCLUDED.is_position_usable, confirmed_movement=EXCLUDED.confirmed_movement,
  candidate_movement=EXCLUDED.candidate_movement, candidate_count=EXCLUDED.candidate_count,
  airborne_episode_seq=EXCLUDED.airborne_episode_seq, not_seen_seq=EXCLUDED.not_seen_seq,
  last_provider_contact_at=EXCLUDED.last_provider_contact_at, event_version=EXCLUDED.event_version,
  updated_at=EXCLUDED.updated_at
`

export interface IngestionRunRecord {
  mode: string
  success: boolean
  errorClass?: string | null
  errorMessage?: string | null
  sourceLatencyMs?: number | null
  aircraftCount?: number | null
  lastSuccessfulCycleAt?: number | null
}

/** Ensure roster rows exist and seed empty state rows for new registrations. */
export async function ensureRoster(defs: TrackedAircraftDef[]): Promise<void> {
  await withClient(async (c) => {
    for (const d of defs) {
      await c.query(
        `INSERT INTO tracked_aircraft (registration, description, type_label)
         VALUES ($1,$2,$3)
         ON CONFLICT (registration) DO UPDATE SET description=EXCLUDED.description, type_label=EXCLUDED.type_label`,
        [d.registration, d.description, d.typeLabel],
      )
      const rec = emptyRecord(d.registration, d.description, Date.now())
      await c.query(
        `INSERT INTO aircraft_current_state (registration) VALUES ($1) ON CONFLICT (registration) DO NOTHING`,
        [rec.registration],
      )
    }
  })
}

/** Hydrate all durable records into memory (called on worker + web read boot). */
export async function loadAllRecords(): Promise<Map<string, AircraftRecord>> {
  const { rows } = await query<AircraftStateRow & { description: string | null }>(
    `SELECT s.*, t.description
       FROM aircraft_current_state s
       JOIN tracked_aircraft t ON t.registration = s.registration
      WHERE t.active = TRUE`,
  )
  const out = new Map<string, AircraftRecord>()
  for (const row of rows) out.set(row.registration, rowToRecord(row, row.description ?? ''))
  return out
}

export async function upsertRecord(rec: AircraftRecord): Promise<void> {
  await query(UPSERT_STATE, recordToParams(rec))
}

export async function saveMapping(registration: string, icao24: string, status: MappingStatus): Promise<void> {
  await query(
    `UPDATE tracked_aircraft
        SET icao24=$2, mapping_status=$3, resolved_at=NOW(), last_verified_at=NOW()
      WHERE registration=$1`,
    [registration, icao24 || null, status],
  )
}

export async function loadMapping(registration: string): Promise<{ icao24: string | null; status: string } | null> {
  const { rows } = await query<{ icao24: string | null; mapping_status: string }>(
    `SELECT icao24, mapping_status FROM tracked_aircraft WHERE registration=$1`,
    [registration],
  )
  if (rows.length === 0) return null
  return { icao24: rows[0].icao24, status: rows[0].mapping_status }
}

/**
 * Insert an event idempotently. Returns true only if this call actually created
 * the row (first occurrence of the dedup_key) — callers use that to decide
 * whether to enqueue a notification exactly once.
 */
export async function insertEventIfNew(ev: AircraftEvent, userId: number | null = null): Promise<boolean> {
  const { rowCount } = await query(
    `INSERT INTO aircraft_events
       (dedup_key, event_type, registration, icao24, occurred_at, previous_state, current_state, message, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (dedup_key) DO NOTHING`,
    [ev.dedupKey, ev.eventType, ev.registration, ev.icao24 || null,
     new Date(ev.occurredAt).toISOString(), ev.previousState, ev.currentState, ev.message, userId],
  )
  return rowCount > 0
}

export async function recordIngestionRun(r: IngestionRunRecord): Promise<void> {
  await query(
    `INSERT INTO ingestion_runs
       (finished_at, mode, success, error_class, error_message, source_latency_ms, aircraft_count, last_successful_cycle_at)
     VALUES (NOW(),$1,$2,$3,$4,$5,$6,$7)`,
    [r.mode, r.success, r.errorClass ?? null, r.errorMessage ?? null,
     r.sourceLatencyMs ?? null, r.aircraftCount ?? null,
     r.lastSuccessfulCycleAt ? new Date(r.lastSuccessfulCycleAt).toISOString() : null],
  )
}

export async function lastSuccessfulCycleAt(): Promise<number | null> {
  const { rows } = await query<{ last_successful_cycle_at: Date | null }>(
    `SELECT last_successful_cycle_at FROM ingestion_runs
      WHERE success = TRUE AND last_successful_cycle_at IS NOT NULL
      ORDER BY started_at DESC LIMIT 1`,
  )
  const v = rows[0]?.last_successful_cycle_at
  return v ? new Date(v).getTime() : null
}
