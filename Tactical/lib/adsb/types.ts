/**
 * Shared domain types for the ADS-B tracking dashboard.
 * Pure type declarations — no runtime, safe to import anywhere.
 */

export type MovementClass = 'airborne' | 'ground' | 'unknown'

export type AircraftLifecycleState =
  | 'unresolved'      // no verified ICAO24 mapping yet
  | 'live_airborne'
  | 'live_ground'
  | 'stale'           // position aged past fresh, not yet unavailable
  | 'unavailable'     // position aged past the unavailable threshold

export type DataStatus = 'live' | 'stale' | 'unavailable'

export type MappingStatus = 'verified' | 'unresolved'

export type AircraftEventType =
  | 'takeoff'
  | 'landing'
  | 'telemetry_not_seen'
  | 'reappeared'
  | 'proximity_enter'

/**
 * Durable per-aircraft record. This is the shape persisted to
 * `aircraft_current_state` and hydrated on worker boot. All telemetry is
 * explicitly nullable — a null means "unknown", never a false 0.
 */
export interface AircraftRecord {
  registration: string
  description: string
  icao24: string | null
  mappingStatus: MappingStatus

  state: AircraftLifecycleState
  dataStatus: DataStatus

  // Absolute time of the last POSITION observation, epoch ms, derived from
  // providerNow − seen_pos*1000. NEVER local poll time.
  lastObservedAt: number | null
  latitude: number | null
  longitude: number | null
  altitudeMetres: number | null
  groundSpeedKt: number | null
  trackDegrees: number | null
  verticalRateFpm: number | null
  onGround: boolean | null
  seenPosSeconds: number | null
  seenSeconds: number | null
  isPositionUsable: boolean

  // Debounced movement classification.
  confirmedMovement: MovementClass
  candidateMovement: MovementClass
  candidateCount: number

  // Monotonic episode sequences → idempotent event keys (no Date.now()).
  airborneEpisodeSeq: number
  notSeenSeq: number

  // Last time the provider actually returned this hex (epoch ms).
  lastProviderContactAt: number | null

  eventVersion: number
  updatedAt: number
}

/**
 * A transition/alert event produced by the state machine. `dedupKey` is a
 * stable, replay-safe idempotency key derived from episode sequences.
 */
export interface AircraftEvent {
  eventType: AircraftEventType
  registration: string
  icao24: string
  occurredAt: number          // epoch ms
  previousState: AircraftLifecycleState
  currentState: AircraftLifecycleState
  dedupKey: string
  /** Non-alarmist, display-safe message. */
  message: string
}

export interface FreshnessConfig {
  freshSeconds: number         // < fresh → live
  unavailableSeconds: number   // > unavailable → unavailable; between → stale
}

export interface MovementConfig {
  airborneAltFt: number        // above this baro altitude → airborne evidence
  groundAltFt: number          // at/below this + slow → ground evidence
  airborneSpeedKt: number      // above this ground speed → airborne evidence
  groundSpeedKt: number        // below this ground speed → ground evidence
  confirmObservations: number  // consecutive consistent obs required to switch
}

export interface ProximityConfigMetres {
  enterMetres: number
  exitMetres: number
}
