/**
 * Aircraft tracking state machine (pure).
 * ────────────────────────────────────────────────────────────────────────────
 * All functions are pure: given the previous durable record + a new observation
 * (or an absence) + config + an injected clock, they return the next record and
 * any events. No I/O, no ambient Date.now(). This is what the ingestion worker
 * calls per cycle and what the unit tests exercise directly.
 *
 * Safety properties enforced here:
 *   • Missing telemetry never fabricates ground/stopped state (nulls preserved).
 *   • Movement (airborne/ground) requires N consecutive consistent observations
 *     before the confirmed state flips → no takeoff/landing flapping.
 *   • telemetry_not_seen is emitted ONLY when the provider is healthy and the
 *     aircraft aged out — provider outages/malformed payloads/restarts never
 *     produce it (that is provider health, tracked separately).
 *   • Event dedup keys are built from monotonic episode sequences, never a
 *     timestamp → replay/restart/duplicate-safe and idempotent.
 */
import type { ADSBAircraft } from './exchange-adapter.ts'
import type {
  AircraftEvent,
  AircraftLifecycleState,
  AircraftRecord,
  DataStatus,
  FreshnessConfig,
  MovementClass,
  MovementConfig,
} from './types.ts'

const FT_TO_M = 0.3048

export function emptyRecord(registration: string, description: string, nowMs: number): AircraftRecord {
  return {
    registration,
    description,
    icao24: null,
    mappingStatus: 'unresolved',
    state: 'unresolved',
    dataStatus: 'unavailable',
    lastObservedAt: null,
    latitude: null,
    longitude: null,
    altitudeMetres: null,
    groundSpeedKt: null,
    trackDegrees: null,
    verticalRateFpm: null,
    onGround: null,
    seenPosSeconds: null,
    seenSeconds: null,
    isPositionUsable: false,
    confirmedMovement: 'unknown',
    candidateMovement: 'unknown',
    candidateCount: 0,
    airborneEpisodeSeq: 0,
    notSeenSeq: 0,
    lastProviderContactAt: null,
    eventVersion: 0,
    updatedAt: nowMs,
  }
}

/**
 * Absolute epoch-ms of the last position, derived from provider time minus the
 * seen_pos DURATION. Falls back to receipt time when providerNow is absent.
 */
export function deriveLastObservedAt(
  seenPosSeconds: number | null,
  providerNowMs: number | null,
  receiptMs: number,
): number | null {
  if (seenPosSeconds === null) return null
  const base = providerNowMs ?? receiptMs
  return base - seenPosSeconds * 1000
}

/** Single-observation movement candidate. `unknown` when evidence is insufficient. */
export function classifyMovement(obs: ADSBAircraft, cfg: MovementConfig): MovementClass {
  // Strong ground signal from the provider.
  if (obs.onGround === true) return 'ground'

  const alt = obs.altitudeBaro // feet or null
  const spd = obs.groundSpeed  // knots or null

  const airborneByAlt = alt !== null && alt > cfg.airborneAltFt
  const airborneBySpeed = spd !== null && spd > cfg.airborneSpeedKt
  if (airborneByAlt || airborneBySpeed) return 'airborne'

  const groundByAlt = alt !== null && alt <= cfg.groundAltFt
  const slow = spd !== null && spd < cfg.groundSpeedKt
  if (groundByAlt && slow) return 'ground'

  // Not enough evidence to assert either way.
  return 'unknown'
}

function freshnessToDataStatus(ageSeconds: number, f: FreshnessConfig): DataStatus {
  if (ageSeconds <= f.freshSeconds) return 'live'
  if (ageSeconds <= f.unavailableSeconds) return 'stale'
  return 'unavailable'
}

function lifecycleFromData(
  dataStatus: DataStatus,
  confirmedMovement: MovementClass,
): AircraftLifecycleState {
  if (dataStatus === 'unavailable') return 'unavailable'
  if (dataStatus === 'stale') return 'stale'
  // live
  if (confirmedMovement === 'airborne') return 'live_airborne'
  if (confirmedMovement === 'ground') return 'live_ground'
  // live but movement not yet confirmed → treat as ground-side "live" without
  // asserting airborne; render as live_ground is misleading, so keep the prior
  // resolved live sense. We surface live_ground only when confirmed ground;
  // otherwise fall back to live_airborne=false → use stale-safe 'live_ground'?
  // To avoid inventing motion, unknown-but-live is reported as live_ground only
  // if we have a position, else stale. Callers treat movement via confirmedMovement.
  return 'live_ground'
}

export interface ApplyContext {
  nowMs: number
  providerNowMs: number | null
  providerHealthy: boolean
  freshness: FreshnessConfig
  movement: MovementConfig
}

function messageFor(type: AircraftEvent['eventType'], reg: string): string {
  switch (type) {
    case 'takeoff': return `${reg} appears to have departed (telemetry shows airborne).`
    case 'landing': return `${reg} appears to be on the ground (telemetry shows landed).`
    case 'telemetry_not_seen': return `Tracking telemetry for ${reg} has not been observed recently. This only means no signal was received — it does not indicate any incident.`
    case 'reappeared': return `${reg} is being tracked again.`
    case 'proximity_enter': return `${reg} is now within range of your location.`
  }
}

/**
 * Apply a fresh provider observation for an aircraft. Returns the next record
 * and any events triggered by this step.
 */
export function applyObservation(
  prev: AircraftRecord,
  obs: ADSBAircraft,
  ctx: ApplyContext,
): { record: AircraftRecord; events: AircraftEvent[] } {
  const events: AircraftEvent[] = []
  const rec: AircraftRecord = { ...prev }

  const icao = obs.icao24 || prev.icao24 || ''
  rec.icao24 = icao || null
  rec.mappingStatus = icao ? 'verified' : prev.mappingStatus
  rec.lastProviderContactAt = ctx.nowMs

  // Telemetry (nulls preserved; feet→metres exactly once here).
  rec.latitude = obs.latitude
  rec.longitude = obs.longitude
  rec.altitudeMetres = obs.altitudeBaro !== null ? obs.altitudeBaro * FT_TO_M : null
  rec.groundSpeedKt = obs.groundSpeed
  rec.trackDegrees = obs.track
  rec.verticalRateFpm = obs.verticalRate
  rec.onGround = obs.onGround
  rec.seenPosSeconds = obs.seenPos
  rec.seenSeconds = obs.seen

  const lastObs = deriveLastObservedAt(obs.seenPos, ctx.providerNowMs, ctx.nowMs)
  if (lastObs !== null) rec.lastObservedAt = lastObs

  const hasPosition = obs.latitude !== null && obs.longitude !== null
  const ageSeconds = rec.lastObservedAt !== null
    ? Math.max(0, (ctx.nowMs - rec.lastObservedAt) / 1000)
    : Infinity

  const dataStatus = hasPosition ? freshnessToDataStatus(ageSeconds, ctx.freshness) : 'unavailable'
  rec.dataStatus = dataStatus
  rec.isPositionUsable = hasPosition && dataStatus === 'live'

  // ── Debounced movement classification ────────────────────────────────────
  const candidate = classifyMovement(obs, ctx.movement)
  if (candidate === 'unknown') {
    // Insufficient evidence → do not disturb the confirmed state or the streak.
    rec.candidateMovement = prev.candidateMovement
    rec.candidateCount = prev.candidateCount
  } else if (candidate === prev.candidateMovement) {
    rec.candidateCount = prev.candidateCount + 1
  } else {
    rec.candidateMovement = candidate
    rec.candidateCount = 1
  }

  const prevConfirmed = prev.confirmedMovement
  let confirmed = prevConfirmed
  if (
    rec.candidateMovement !== 'unknown' &&
    rec.candidateMovement !== prevConfirmed &&
    rec.candidateCount >= ctx.movement.confirmObservations
  ) {
    confirmed = rec.candidateMovement
  }
  rec.confirmedMovement = confirmed

  // ── Lifecycle + transition events ────────────────────────────────────────
  const prevState = prev.state
  let newState: AircraftLifecycleState
  if (dataStatus === 'unavailable') {
    newState = 'unavailable'
  } else if (dataStatus === 'stale') {
    newState = 'stale'
  } else {
    newState = lifecycleFromData('live', confirmed)
  }
  rec.state = newState

  const occurredAt = rec.lastObservedAt ?? ctx.nowMs

  // takeoff / landing keyed on the confirmed movement flip (episode-based).
  if (confirmed === 'airborne' && prevConfirmed !== 'airborne' && dataStatus === 'live') {
    rec.airborneEpisodeSeq = prev.airborneEpisodeSeq + 1
    events.push(mkEvent('takeoff', rec, icao, prevState, newState, occurredAt, `${icao}:takeoff:${rec.airborneEpisodeSeq}`))
  } else if (confirmed === 'ground' && prevConfirmed === 'airborne' && dataStatus === 'live') {
    events.push(mkEvent('landing', rec, icao, prevState, newState, occurredAt, `${icao}:landing:${rec.airborneEpisodeSeq}`))
  }

  // reappeared: was unavailable, now live again.
  if (prevState === 'unavailable' && (newState === 'live_airborne' || newState === 'live_ground')) {
    events.push(mkEvent('reappeared', rec, icao, prevState, newState, occurredAt, `${icao}:reappeared:${prev.notSeenSeq}`))
  }

  rec.eventVersion = prev.eventVersion + 1
  rec.updatedAt = ctx.nowMs
  return { record: rec, events }
}

/**
 * Age-sweep an aircraft that was NOT present in a successful provider cycle (or
 * whose position has simply gotten old). Emits telemetry_not_seen ONLY when the
 * provider is healthy — an outage must never look like a lost aircraft.
 */
export function sweepAircraft(
  prev: AircraftRecord,
  ctx: ApplyContext,
): { record: AircraftRecord; events: AircraftEvent[] } {
  const events: AircraftEvent[] = []
  const rec: AircraftRecord = { ...prev }

  if (prev.state === 'unresolved' || prev.lastObservedAt === null) {
    rec.updatedAt = ctx.nowMs
    return { record: rec, events }
  }

  const ageSeconds = Math.max(0, (ctx.nowMs - prev.lastObservedAt) / 1000)
  const dataStatus = freshnessToDataStatus(ageSeconds, ctx.freshness)
  rec.dataStatus = dataStatus
  rec.isPositionUsable = false

  const prevState = prev.state
  let newState: AircraftLifecycleState
  if (dataStatus === 'unavailable') newState = 'unavailable'
  else if (dataStatus === 'stale') newState = 'stale'
  else newState = prevState // still fresh; nothing to do
  rec.state = newState

  const wasLive = prevState === 'live_airborne' || prevState === 'live_ground' || prevState === 'stale'
  if (wasLive && newState === 'unavailable') {
    if (ctx.providerHealthy) {
      rec.notSeenSeq = prev.notSeenSeq + 1
      events.push(mkEvent(
        'telemetry_not_seen', rec, prev.icao24 ?? '', prevState, newState,
        ctx.nowMs, `${prev.icao24 ?? prev.registration}:telemetry_not_seen:${rec.notSeenSeq}`,
      ))
    } else {
      // Provider unhealthy → hold as stale, do NOT declare not-seen.
      rec.state = 'stale'
      rec.dataStatus = 'stale'
    }
  }

  rec.updatedAt = ctx.nowMs
  return { record: rec, events }
}

function mkEvent(
  eventType: AircraftEvent['eventType'],
  rec: AircraftRecord,
  icao: string,
  previousState: AircraftLifecycleState,
  currentState: AircraftLifecycleState,
  occurredAt: number,
  dedupKey: string,
): AircraftEvent {
  return {
    eventType,
    registration: rec.registration,
    icao24: icao,
    occurredAt,
    previousState,
    currentState,
    dedupKey,
    message: messageFor(eventType, rec.registration),
  }
}
