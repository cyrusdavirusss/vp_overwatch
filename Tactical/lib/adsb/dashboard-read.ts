/**
 * Read-side dashboard snapshot for the web/API. Reads durable state from PG and
 * recomputes freshness at READ time so a stalled worker or provider outage
 * surfaces as stale/unavailable without needing a write. Never calls the
 * provider.
 */
import { loadAllRecords, lastSuccessfulCycleAt } from './persistence/dashboard-persistence.ts'
import { freshnessConfig } from './config.ts'
import type { AircraftRecord, DataStatus, AircraftLifecycleState } from './types.ts'

export interface DashboardAircraftDTO {
  registration: string
  description: string
  icao24: string | null
  mappingStatus: string
  state: AircraftLifecycleState
  dataStatus: DataStatus
  lastObservedAt: string | null
  positionAgeSeconds: number | null
  latitude: number | null
  longitude: number | null
  altitudeMetres: number | null
  groundSpeedKt: number | null
  trackDegrees: number | null
  verticalRateFpm: number | null
  onGround: boolean | null
  isPositionUsable: boolean
}

export interface DashboardSnapshotDTO {
  aircraft: DashboardAircraftDTO[]
  lastUpdate: string
  providerStatus: 'live' | 'stale' | 'unavailable'
  lastSuccessfulCycleAt: string | null
  count: number
}

function recompute(rec: AircraftRecord, nowMs: number): { state: AircraftLifecycleState; dataStatus: DataStatus; ageSec: number | null } {
  const f = freshnessConfig()
  // No verified hex mapping → genuinely unresolved.
  if (rec.mappingStatus !== 'verified') {
    return { state: 'unresolved', dataStatus: 'unavailable', ageSec: null }
  }
  // Mapped but never observed (aircraft not currently broadcasting) → no signal,
  // NOT 'unresolved' (which would wrongly imply we don't know the aircraft).
  if (rec.lastObservedAt === null) {
    return { state: 'unavailable', dataStatus: 'unavailable', ageSec: null }
  }
  const ageSec = Math.max(0, (nowMs - rec.lastObservedAt) / 1000)
  let dataStatus: DataStatus
  if (ageSec <= f.freshSeconds) dataStatus = 'live'
  else if (ageSec <= f.unavailableSeconds) dataStatus = 'stale'
  else dataStatus = 'unavailable'

  let state: AircraftLifecycleState
  if (dataStatus === 'unavailable') state = 'unavailable'
  else if (dataStatus === 'stale') state = 'stale'
  else state = rec.confirmedMovement === 'airborne' ? 'live_airborne' : 'live_ground'
  return { state, dataStatus, ageSec }
}

function toDTO(rec: AircraftRecord, nowMs: number): DashboardAircraftDTO {
  const { state, dataStatus, ageSec } = recompute(rec, nowMs)
  return {
    registration: rec.registration,
    description: rec.description,
    icao24: rec.icao24,
    mappingStatus: rec.mappingStatus,
    state,
    dataStatus,
    lastObservedAt: rec.lastObservedAt ? new Date(rec.lastObservedAt).toISOString() : null,
    positionAgeSeconds: ageSec,
    latitude: rec.latitude,
    longitude: rec.longitude,
    altitudeMetres: rec.altitudeMetres,
    groundSpeedKt: rec.groundSpeedKt,
    trackDegrees: rec.trackDegrees,
    verticalRateFpm: rec.verticalRateFpm,
    onGround: rec.onGround,
    isPositionUsable: dataStatus === 'live' && rec.latitude !== null && rec.longitude !== null,
  }
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshotDTO> {
  const now = Date.now()
  const records = [...(await loadAllRecords()).values()].sort((a, b) => a.registration.localeCompare(b.registration))
  const aircraft = records.map((r) => toDTO(r, now))
  const cycleAt = await lastSuccessfulCycleAt()

  // Provider status: healthy if a successful cycle happened within 2× the
  // unavailable window; else stale/unavailable.
  const f = freshnessConfig()
  let providerStatus: 'live' | 'stale' | 'unavailable' = 'unavailable'
  if (cycleAt !== null) {
    const ageSec = (now - cycleAt) / 1000
    providerStatus = ageSec <= f.freshSeconds ? 'live' : ageSec <= f.unavailableSeconds ? 'stale' : 'unavailable'
  }

  return {
    aircraft,
    lastUpdate: new Date(now).toISOString(),
    providerStatus,
    lastSuccessfulCycleAt: cycleAt ? new Date(cycleAt).toISOString() : null,
    count: aircraft.length,
  }
}

export async function getAircraftByRegistration(registration: string): Promise<DashboardAircraftDTO | null> {
  const now = Date.now()
  const rec = (await loadAllRecords()).get(registration.trim().toUpperCase())
  return rec ? toDTO(rec, now) : null
}
