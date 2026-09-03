/**
 * Dashboard Persistence Layer
 * 
 * PostgreSQL-backed persistence for normalized aircraft state.
 * Provides durable storage across hot reloads, container restarts,
 * and multiple instances in production deployments.
 * 
 * This is the source of truth in production, replacing in-memory-only state.
 */

export interface AircraftStateRecord {
  registration: string
  icao24: string
  description: string
  state: string
  lastObservedAt: Date
  positionFreshnessSeconds: number
  latitude: number | null
  longitude: number | null
  altitudeMetres: number
  groundSpeedKt: number
  trackDegrees: number
  isPositionUsable: boolean
  dataStatus: string
  seenPos: number
  seen: number
  eventVersion: number
  createdAt: Date
  updatedAt: Date
}

export interface Icao24Mapping {
  registration: string
  icao24: string
  verified: boolean
  resolvedAt: Date
  lastVerifiedAt: Date
}

export interface IngestionMetadata {
  lastIngestionAt: Date
  ingestionMode: 'streaming' | 'batch'
  providerStatus: string
  sourceLatencySeconds: number
  errorClass: string | null
  errorMessage: string | null
}

export class DashboardPersistence {
  private connectionString: string
  private pool: any | null = null
  
  constructor(connectionString: string) {
    this.connectionString = connectionString
  }
  
  /**
   * Initialize database connection pool.
   */
  async initialize(): Promise<void> {
    try {
      // Import pg dynamically to support server-side rendering
      const pg = await import('pg')
      this.pool = new pg.Pool({
        connectionString: this.connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      })
      
      this.pool.on('error', (err) => {
        console.error('[Dashboard Persistence] Unexpected pool error:', err)
      })
      
      await this.ensureTables()
      console.log('[Dashboard Persistence] Database connection established')
    } catch (error) {
      console.error('[Dashboard Persistence] Failed to initialize database:', error)
      throw error
    }
  }
  
  /**
   * Ensure required tables exist.
   */
  private async ensureTables(): Promise<void> {
    if (!this.pool) return
    
    const client = await this.pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS adsb_aircraft_state (
          registration VARCHAR(20) PRIMARY KEY,
          icao24 VARCHAR(12) NOT NULL,
          description TEXT,
          state VARCHAR(50) NOT NULL,
          last_observed_at TIMESTAMPTZ NOT NULL,
          position_freshness_seconds INTEGER NOT NULL,
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          altitude_metres INTEGER NOT NULL,
          ground_speed_kt INTEGER NOT NULL,
          track_degrees INTEGER NOT NULL,
          is_position_usable BOOLEAN NOT NULL,
          data_status VARCHAR(50) NOT NULL,
          seen_pos INTEGER NOT NULL,
          seen INTEGER NOT NULL,
          event_version BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS adsb_icao24_mappings (
          registration VARCHAR(20) PRIMARY KEY,
          icao24 VARCHAR(12) NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT false,
          resolved_at TIMESTAMPTZ NOT NULL,
          last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS adsb_ingestion_metadata (
          id SERIAL PRIMARY KEY,
          last_ingestion_at TIMESTAMPTZ NOT NULL,
          ingestion_mode VARCHAR(20) NOT NULL,
          provider_status VARCHAR(50) NOT NULL,
          source_latency_seconds DOUBLE PRECISION NOT NULL,
          error_class VARCHAR(100),
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_aircraft_state_icao24 
        ON adsb_aircraft_state(icao24)
      `)
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_aircraft_state_state 
        ON adsb_aircraft_state(state)
      `)
      
      console.log('[Dashboard Persistence] Database schema ensured')
    } finally {
      client.release()
    }
  }
  
  /**
   * Save aircraft state atomically.
   * 
   * @param state Aircraft state record
   */
  async saveAircraftState(state: any): Promise<void> {
    if (!this.pool) throw new Error('Persistence not initialized')
    
    const client = await this.pool.connect()
    try {
      await client.query(`
        INSERT INTO adsb_aircraft_state (
          registration, icao24, description, state, last_observed_at,
          position_freshness_seconds, latitude, longitude, altitude_metres,
          ground_speed_kt, track_degrees, is_position_usable, data_status,
          seen_pos, seen, event_version, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        ON CONFLICT (registration) DO UPDATE SET
          icao24 = EXCLUDED.icao24,
          description = EXCLUDED.description,
          state = EXCLUDED.state,
          last_observed_at = EXCLUDED.last_observed_at,
          position_freshness_seconds = EXCLUDED.position_freshness_seconds,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          altitude_metres = EXCLUDED.altitude_metres,
          ground_speed_kt = EXCLUDED.ground_speed_kt,
          track_degrees = EXCLUDED.track_degrees,
          is_position_usable = EXCLUDED.is_position_usable,
          data_status = EXCLUDED.data_status,
          seen_pos = EXCLUDED.seen_pos,
          seen = EXCLUDED.seen,
          event_version = EXCLUDED.event_version,
          updated_at = NOW()
      `, [
        state.registration,
        state.icao24,
        state.description,
        state.state,
        state.lastObservedAt,
        state.positionFreshnessSeconds,
        state.latitude,
        state.longitude,
        state.altitudeMetres,
        state.groundSpeedKt,
        state.trackDegrees,
        state.isPositionUsable,
        state.dataStatus,
        state.seenPos,
        state.seen,
        state.eventVersion
      ])
    } finally {
      client.release()
    }
  }
  
  /**
   * Load all aircraft state from database.
   * 
   * @returns Array of aircraft state records
   */
  async loadAllAircraftState(): Promise<AircraftStateRecord[]> {
    if (!this.pool) throw new Error('Persistence not initialized')
    
    const result = await this.pool.query(`
      SELECT * FROM adsb_aircraft_state
      ORDER BY registration
    `)
    
    return result.rows.map((row: any) => ({
      registration: row.registration,
      icao24: row.icao24,
      description: row.description,
      state: row.state,
      lastObservedAt: row.last_observed_at,
      positionFreshnessSeconds: row.position_freshness_seconds,
      latitude: row.latitude,
      longitude: row.longitude,
      altitudeMetres: row.altitude_metres,
      groundSpeedKt: row.ground_speed_kt,
      trackDegrees: row.track_degrees,
      isPositionUsable: row.is_position_usable,
      dataStatus: row.data_status,
      seenPos: row.seen_pos,
      seen: row.seen,
      eventVersion: row.event_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }
  
  /**
   * Save ICAO24 mapping.
   * 
   * @param mapping ICAO24 mapping record
   */
  async saveIcao24Mapping(mapping: Icao24Mapping): Promise<void> {
    if (!this.pool) throw new Error('Persistence not initialized')
    
    await this.pool.query(`
      INSERT INTO adsb_icao24_mappings (registration, icao24, verified, resolved_at, last_verified_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (registration) DO UPDATE SET
        icao24 = EXCLUDED.icao24,
        verified = EXCLUDED.verified,
        last_verified_at = EXCLUDED.last_verified_at
    `, [
      mapping.registration,
      mapping.icao24,
      mapping.verified,
      mapping.resolvedAt,
      mapping.lastVerifiedAt
    ])
  }
  
  /**
   * Load ICAO24 mapping for a registration.
   * 
   * @param registration Aircraft registration
   * @returns ICAO24 mapping or null
   */
  async loadIcao24Mapping(registration: string): Promise<Icao24Mapping | null> {
    if (!this.pool) throw new Error('Persistence not initialized')
    
    const result = await this.pool.query(`
      SELECT * FROM adsb_icao24_mappings WHERE registration = $1
    `, [registration])
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      registration: row.registration,
      icao24: row.icao24,
      verified: row.verified,
      resolvedAt: row.resolved_at,
      lastVerifiedAt: row.last_verified_at
    }
  }
  
  /**
   * Save ingestion metadata.
   * 
   * @param metadata Ingestion metadata record
   */
  async saveIngestionMetadata(metadata: IngestionMetadata): Promise<void> {
    if (!this.pool) throw new Error('Persistence not initialized')
    
    await this.pool.query(`
      INSERT INTO adsb_ingestion_metadata (
        last_ingestion_at, ingestion_mode, provider_status,
        source_latency_seconds, error_class, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      metadata.lastIngestionAt,
      metadata.ingestionMode,
      metadata.providerStatus,
      metadata.sourceLatencySeconds,
      metadata.errorClass,
      metadata.errorMessage
    ])
  }
  
  /**
   * Load latest ingestion metadata.
   * 
   * @returns Latest ingestion metadata or null
   */
  async loadLatestIngestionMetadata(): Promise<IngestionMetadata | null> {
    if (!this.pool) throw new Error('Persistence not initialized')
    
    const result = await this.pool.query(`
      SELECT * FROM adsb_ingestion_metadata
      ORDER BY created_at DESC
      LIMIT 1
    `)
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      lastIngestionAt: row.last_ingestion_at,
      ingestionMode: row.ingestion_mode,
      providerStatus: row.provider_status,
      sourceLatencySeconds: row.source_latency_seconds,
      errorClass: row.error_class,
      errorMessage: row.error_message
    }
  }
  
  /**
   * Close database connection pool.
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
      console.log('[Dashboard Persistence] Database connection closed')
    }
  }
}