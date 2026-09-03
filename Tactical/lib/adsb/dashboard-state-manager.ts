/**
 * Dashboard State Manager
 * 
 * Manages normalized aircraft state for the live dashboard.
 * Provides cache-backed state with proper state classification.
 * 
 * State values: unresolved, live_airborne, live_ground, stale, unavailable
 * Event types: takeoff, landing, telemetry_not_seen, reappeared, proximity_enter
 */

import { ADSBAircraft, RegistrationLookup } from './exchange-adapter'

export type AircraftState = 'unresolved' | 'live_airborne' | 'live_ground' | 'stale' | 'unavailable'

export type DataStatus = 'live' | 'stale' | 'unavailable'

export interface DashboardAircraftState {
  registration: string
  description: string
  icao24: string
  state: AircraftState
  lastObservedAt: Date
  positionFreshnessSeconds: number
  latitude: number | null
  longitude: number | null
  altitudeMetres: number
  groundSpeedKt: number
  trackDegrees: number
  isPositionUsable: boolean
  dataStatus: DataStatus
  seenPos: number
  seen: number
  eventVersion: number
}

export interface DashboardSnapshot {
  aircraft: DashboardAircraftState[]
  lastUpdate: Date
  sourceLatencySeconds: number
  providerStatus: 'live' | 'stale' | 'unavailable'
  ingestionMode: 'streaming' | 'batch'
  lastIngestionAt: Date
}

export interface AircraftEvent {
  eventType: 'takeoff' | 'landing' | 'telemetry_not_seen' | 'reappeared' | 'proximity_enter'
  registration: string
  icao24: string
  occurredAt: Date
  previousState: AircraftState
  currentState: AircraftState
  dedupKey: string
}

export class DashboardStateManager {
  private aircraftState: Map<string, DashboardAircraftState> = new Map()
  private registrationMap: Map<string, string> = new Map()
  private icao24Map: Map<string, string> = new Map()
  private lastSnapshot: DashboardSnapshot | null = null
  private lastIngestionAt: Date = new Date(0)
  private ingestionMode: 'streaming' | 'batch' = 'batch'
  private eventVersionCounter: Map<string, number> = new Map()
  private freshnessThresholdSeconds: number = 300
  private positionFreshnessThresholdSeconds: number = 60
  
  constructor(
    private registrations: string[],
    private descriptions: Map<string, string>
  ) {
    this.initializeEmptyStates()
  }
  
  /**
   * Initialize empty state entries for all tracked aircraft.
   */
  private initializeEmptyStates(): void {
    for (const registration of this.registrations) {
      this.aircraftState.set(registration, {
        registration: registration,
        description: this.descriptions.get(registration) || '',
        icao24: '',
        state: 'unresolved',
        lastObservedAt: new Date(0),
        positionFreshnessSeconds: Infinity,
        latitude: null,
        longitude: null,
        altitudeMetres: 0,
        groundSpeedKt: 0,
        trackDegrees: 0,
        isPositionUsable: false,
        dataStatus: 'unavailable',
        seenPos: 0,
        seen: 0,
        eventVersion: 0
      })
    }
  }
  
  /**
   * Initialize with resolved ICAO24 mappings.
   * 
   * @param registrations Array of aircraft registrations
   * @param descriptions Map of registration to description
   */
  async initialize(
    registrations: string[],
    descriptions: Map<string, string>
  ): Promise<void> {
    this.registrations = registrations
    this.descriptions = descriptions
    this.initializeEmptyStates()
  }
  
  /**
   * Update state from batched aircraft data.
   * 
   * This method is called by the ingestion worker (not by dashboard endpoints).
   * It processes all aircraft in a single iteration.
   * 
   * @param aircraftData Map of ICAO24 to aircraft data
   * @returns Updated snapshot
   */
  async updateState(aircraftData: Map<string, ADSBAircraft>): Promise<DashboardSnapshot> {
    const now = Date.now()
    const events: AircraftEvent[] = []
    
    for (const [icao24, aircraft] of aircraftData) {
      const registration = aircraft.registration
      const existingState = this.aircraftState.get(registration)
      
      if (!existingState) {
        continue
      }
      
      // Update ICAO24 mapping if resolved
      if (aircraft.icao24 && !this.icao24Map.has(registration)) {
        this.icao24Map.set(registration, icao24)
        this.registrationMap.set(icao24, registration)
      }
      
      // Calculate freshness
      const seenPosSeconds = aircraft.seenPos > 0 
        ? (now - (aircraft.seenPos * 1000)) / 1000 
        : Infinity
      
      const positionFreshness = this.calculatePositionFreshness(
        aircraft.latitude,
        aircraft.longitude,
        seenPosSeconds
      )
      
      // Determine state
      const previousState = existingState.state
      const newState = this.determineAircraftState(
        aircraft,
        positionFreshness,
        existingState.icao24 === '' ? 'unresolved' : previousState
      )
      
      // Detect state change events
      if (newState !== previousState) {
        const event = this.detectStateChangeEvent(
          registration,
          icao24,
          previousState,
          newState,
          aircraft
        )
        if (event) {
          events.push(event)
        }
      }
      
      // Update aircraft state
      existingState.icao24 = icao24
      existingState.state = newState
      existingState.lastObservedAt = new Date(now)
      existingState.positionFreshnessSeconds = positionFreshness
      existingState.latitude = aircraft.latitude
      existingState.longitude = aircraft.longitude
      existingState.altitudeMetres = aircraft.altitudeBaro
      existingState.groundSpeedKt = aircraft.groundSpeed
      existingState.trackDegrees = aircraft.track
      existingState.isPositionUsable = this.isPositionUsable(
        aircraft.latitude,
        aircraft.longitude,
        seenPosSeconds
      )
      existingState.dataStatus = this.determineDataStatus(seenPosSeconds)
      existingState.seenPos = aircraft.seenPos
      existingState.seen = aircraft.seen
      existingState.eventVersion = this.incrementEventVersion(registration)
    }
    
    // Update ingestion metadata
    this.lastIngestionAt = new Date()
    
    // Generate snapshot
    const snapshot: DashboardSnapshot = {
      aircraft: Array.from(this.aircraftState.values()),
      lastUpdate: new Date(),
      sourceLatencySeconds: this.calculateSourceLatency(),
      providerStatus: this.determineProviderStatus(),
      ingestionMode: this.ingestionMode,
      lastIngestionAt: this.lastIngestionAt
    }
    
    this.lastSnapshot = snapshot
    return snapshot
  }
  
  /**
   * Calculate position freshness in seconds.
   */
  private calculatePositionFreshness(
    latitude: number | null,
    longitude: number | null,
    seenPosSeconds: number
  ): number {
    if (latitude === null || longitude === null) {
      return Infinity
    }
    return seenPosSeconds
  }
  
  /**
   * Determine if position is usable based on coordinates and freshness.
   */
  private isPositionUsable(
    latitude: number | null,
    longitude: number | null,
    seenPosSeconds: number
  ): boolean {
    return (
      latitude !== null &&
      longitude !== null &&
      seenPosSeconds <= this.freshnessThresholdSeconds
    )
  }
  
  /**
   * Determine aircraft state based on data.
   */
  private determineAircraftState(
    aircraft: ADSBAircraft,
    positionFreshness: number,
    currentState: AircraftState
  ): AircraftState {
    // Check if unresolved (no ICAO24 mapping)
    if (!aircraft.icao24 || aircraft.icao24 === '') {
      return 'unresolved'
    }
    
    // Check for unavailable (no recent data)
    if (positionFreshness > this.freshnessThresholdSeconds) {
      return 'unavailable'
    }
    
    // Check for stale (data between 60s and 300s)
    if (positionFreshness > this.positionFreshnessThresholdSeconds) {
      return 'stale'
    }
    
    // Determine airborne vs ground
    const isAirborne = 
      aircraft.altitudeBaro > 1000 && // Above 1000m
      aircraft.groundSpeed > 50 // Moving at significant speed
    
    return isAirborne ? 'live_airborne' : 'live_ground'
  }
  
  /**
   * Determine data status based on freshness.
   */
  private determineDataStatus(seenPosSeconds: number): DataStatus {
    if (seenPosSeconds <= this.positionFreshnessThresholdSeconds) {
      return 'live'
    }
    if (seenPosSeconds <= this.freshnessThresholdSeconds) {
      return 'stale'
    }
    return 'unavailable'
  }
  
  /**
   * Detect state change events.
   */
  private detectStateChangeEvent(
    registration: string,
    icao24: string,
    previousState: AircraftState,
    newState: AircraftState,
    aircraft: ADSBAircraft
  ): AircraftEvent | null {
    // Takeoff: ground -> airborne
    if (previousState === 'live_ground' && newState === 'live_airborne') {
      return {
        eventType: 'takeoff',
        registration,
        icao24,
        occurredAt: new Date(),
        previousState,
        currentState: newState,
        dedupKey: `${registration}_takeoff_${Date.now()}`
      }
    }
    
    // Landing: airborne -> ground
    if (previousState === 'live_airborne' && newState === 'live_ground') {
      return {
        eventType: 'landing',
        registration,
        icao24,
        occurredAt: new Date(),
        previousState,
        currentState: newState,
        dedupKey: `${registration}_landing_${Date.now()}`
      }
    }
    
    // Telemetry not seen: live -> unavailable
    if ((previousState === 'live_airborne' || previousState === 'live_ground') &&
        newState === 'unavailable') {
      return {
        eventType: 'telemetry_not_seen',
        registration,
        icao24,
        occurredAt: new Date(),
        previousState,
        currentState: newState,
        dedupKey: `${registration}_telemetry_not_seen_${Date.now()}`
      }
    }
    
    // Reappeared: unavailable -> live
    if (previousState === 'unavailable' && 
        (newState === 'live_airborne' || newState === 'live_ground')) {
      return {
        eventType: 'reappeared',
        registration,
        icao24,
        occurredAt: new Date(),
        previousState,
        currentState: newState,
        dedupKey: `${registration}_reappeared_${Date.now()}`
      }
    }
    
    return null
  }
  
  /**
   * Calculate source latency in seconds.
   */
  private calculateSourceLatency(): number {
    const now = Date.now()
    const aircraftStates = Array.from(this.aircraftState.values())
    
    const liveAircraft = aircraftStates.filter(
      state => state.dataStatus === 'live'
    )
    
    if (liveAircraft.length === 0) {
      return Infinity
    }
    
    const avgFreshness = liveAircraft.reduce(
      (sum, state) => sum + state.positionFreshnessSeconds,
      0
    ) / liveAircraft.length
    
    return avgFreshness
  }
  
  /**
   * Determine overall provider status.
   */
  private determineProviderStatus(): 'live' | 'stale' | 'unavailable' {
    const aircraftStates = Array.from(this.aircraftState.values())
    const liveCount = aircraftStates.filter(
      state => state.dataStatus === 'live'
    ).length
    
    if (liveCount === 0) {
      return 'unavailable'
    }
    if (liveCount < aircraftStates.length / 2) {
      return 'stale'
    }
    return 'live'
  }
  
  /**
   * Increment event version for an aircraft.
   */
  private incrementEventVersion(registration: string): number {
    const current = this.eventVersionCounter.get(registration) || 0
    const next = current + 1
    this.eventVersionCounter.set(registration, next)
    return next
  }
  
  /**
   * Get cached snapshot without triggering provider call.
   */
  getCachedSnapshot(): DashboardSnapshot {
    if (!this.lastSnapshot) {
      // Return empty snapshot if not yet initialized
      return {
        aircraft: Array.from(this.aircraftState.values()),
        lastUpdate: new Date(),
        sourceLatencySeconds: Infinity,
        providerStatus: 'unavailable',
        ingestionMode: this.ingestionMode,
        lastIngestionAt: this.lastIngestionAt
      }
    }
    return this.lastSnapshot
  }
  
  /**
   * Get aircraft state by registration.
   */
  getAircraftState(registration: string): DashboardAircraftState | undefined {
    return this.aircraftState.get(registration)
  }
  
  /**
   * Get tracked aircraft count.
   */
  getTrackedAircraftCount(): number {
    return this.registrations.length
  }
  
  /**
   * Get tracked registrations.
   */
  getTrackedRegistrations(): string[] {
    return [...this.registrations]
  }
  
  /**
   * Set ingestion mode (streaming or batch).
   */
  setIngestionMode(mode: 'streaming' | 'batch'): void {
    this.ingestionMode = mode
  }
  
  /**
   * Get ICAO24 mapping for a registration.
   */
  getIcao24ForRegistration(registration: string): string | undefined {
    return this.icao24Map.get(registration)
  }
}