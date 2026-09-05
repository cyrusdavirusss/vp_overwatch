/**
 * Pure row ↔ record mapping for aircraft_current_state. No DB, no I/O — kept
 * separate so it can be unit-tested without loading `pg`.
 */
import type { AircraftRecord, AircraftLifecycleState, DataStatus, MappingStatus, MovementClass } from '../types.ts'

/** Shape of a row returned from aircraft_current_state (snake_case). */
export interface AircraftStateRow {
  registration: string
  description?: string | null
  icao24: string | null
  mapping_status: string
  state: string
  data_status: string
  last_observed_at: Date | string | null
  latitude: number | null
  longitude: number | null
  altitude_metres: number | null
  ground_speed_kt: number | null
  track_degrees: number | null
  vertical_rate_fpm: number | null
  on_ground: boolean | null
  seen_pos_seconds: number | null
  seen_seconds: number | null
  is_position_usable: boolean
  confirmed_movement: string
  candidate_movement: string
  candidate_count: number
  airborne_episode_seq: string | number
  not_seen_seq: string | number
  last_provider_contact_at: Date | string | null
  event_version: string | number
  updated_at: Date | string
}

const toMs = (v: Date | string | null): number | null => {
  if (v === null) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))

export function rowToRecord(row: AircraftStateRow, description = ''): AircraftRecord {
  return {
    registration: row.registration,
    description: row.description ?? description,
    icao24: row.icao24,
    mappingStatus: row.mapping_status as MappingStatus,
    state: row.state as AircraftLifecycleState,
    dataStatus: row.data_status as DataStatus,
    lastObservedAt: toMs(row.last_observed_at),
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeMetres: row.altitude_metres,
    groundSpeedKt: row.ground_speed_kt,
    trackDegrees: row.track_degrees,
    verticalRateFpm: row.vertical_rate_fpm,
    onGround: row.on_ground,
    seenPosSeconds: row.seen_pos_seconds,
    seenSeconds: row.seen_seconds,
    isPositionUsable: row.is_position_usable,
    confirmedMovement: row.confirmed_movement as MovementClass,
    candidateMovement: row.candidate_movement as MovementClass,
    candidateCount: row.candidate_count,
    airborneEpisodeSeq: num(row.airborne_episode_seq),
    notSeenSeq: num(row.not_seen_seq),
    lastProviderContactAt: toMs(row.last_provider_contact_at),
    eventVersion: num(row.event_version),
    updatedAt: toMs(row.updated_at) ?? Date.now(),
  }
}

/** Ordered positional params for the upsert in dashboard-persistence. */
export function recordToParams(r: AircraftRecord): unknown[] {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
  return [
    r.registration,
    r.icao24,
    r.mappingStatus,
    r.state,
    r.dataStatus,
    iso(r.lastObservedAt),
    r.latitude,
    r.longitude,
    r.altitudeMetres,
    r.groundSpeedKt,
    r.trackDegrees,
    r.verticalRateFpm,
    r.onGround,
    r.seenPosSeconds,
    r.seenSeconds,
    r.isPositionUsable,
    r.confirmedMovement,
    r.candidateMovement,
    r.candidateCount,
    r.airborneEpisodeSeq,
    r.notSeenSeq,
    iso(r.lastProviderContactAt),
    r.eventVersion,
    iso(r.updatedAt),
  ]
}
