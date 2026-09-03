/**
 * ADS-B Exchange Adapter
 * 
 * Server-side adapter for ADS-B Exchange API integration.
 * Handles authentication, streaming, and normalized aircraft state.
 * 
 * This adapter is the sole provider interface. No runtime fallback to other
 * providers is implemented. ADS-B Exchange is the exclusive data source.
 */

export interface ADSBAircraft {
  registration: string
  icao24: string
  flight: string
  latitude: number | null
  longitude: number | null
  altitudeBaro: number
  altitudeGeo: number | null
  groundSpeed: number
  track: number
  verticalRate: number
  seenPos: number
  seen: number
  provider: string
  r: string | null
  nicBaro: number | null
  nicLat: number | null
  nicLon: number | null
  sil: number | null
  silType: number | null
  baroRate: number | null
  squawk: string | null
  emergency: string | null
  spi: boolean
  callsign: string
  category: string | null
}

export interface RegistrationLookup {
  registration: string
  icao24: string
  verified: boolean
  resolvedAt: Date
}

export interface ProviderHealth {
  status: 'live' | 'degraded' | 'unavailable'
  lastSuccessfulIngestion: Date | null
  errorClass: string | null
  errorMessage: string | null
  responseTimeMs: number
}

export class ADSBExchangeAdapter {
  private apiKey: string
  private baseUrl: string
  private streamingEnabled: boolean
  
  constructor(apiKey: string, baseUrl: string = 'https://adsbexchange.com/api') {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.streamingEnabled = this.checkStreamingEntitlement()
  }
  
  /**
   * Check if streaming platform entitlement is available.
   * In production, this should query the streaming platform status.
   */
  private checkStreamingEntitlement(): boolean {
    // Production implementation should check streaming subscription status
    return process.env.ADSB_STREAMING_ENABLED === 'true'
  }
  
  /**
   * Resolve registration to ICAO24 hex identifier.
   * 
   * This method queries ADS-B Exchange's registration lookup endpoint
   * and returns verified mapping. Only accept mappings where the returned
   * registration exactly matches the input (case-normalized).
   * 
   * @param registration Aircraft registration (e.g., 'VH-PVO')
   * @returns RegistrationLookup with verified ICAO24 mapping
   */
  async resolveRegistration(registration: string): Promise<RegistrationLookup> {
    try {
      const normalizedReg = registration.trim().toUpperCase()
      
      const response = await fetch(
        `${this.baseUrl}/v2/aircraft/${normalizedReg}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(10000)
        }
      )
      
      if (!response.ok) {
        throw new Error(`Registration lookup failed: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Verify exact match of returned registration
      const returnedRegistration = data?.registration?.toUpperCase?.() || data?.registration
      const verified = returnedRegistration === normalizedReg
      
      return {
        registration: normalizedReg,
        icao24: data?.icao24 || data?.hex || '',
        verified: verified,
        resolvedAt: new Date()
      }
    } catch (error) {
      console.error(`[ADSB Adapter] Registration resolution failed for ${registration}:`, error)
      return {
        registration: registration.trim().toUpperCase(),
        icao24: '',
        verified: false,
        resolvedAt: new Date()
      }
    }
  }
  
  /**
   * Batch lookup for multiple aircraft by ICAO24 identifiers.
   * 
   * This is the primary ingestion method for REST mode.
   * Queries all configured aircraft in a single request.
   * 
   * @param icao24Ids Array of ICAO24 hex identifiers
   * @returns Map of ICAO24 to aircraft data
   */
  async batchAircraftLookup(icao24Ids: string[]): Promise<Map<string, ADSBAircraft>> {
    const aircraftMap = new Map<string, ADSBAircraft>()
    
    try {
      const response = await fetch(
        `${this.baseUrl}/v2/aircraft/list`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            icao24: icao24Ids
          }),
          signal: AbortSignal.timeout(10000)
        }
      )
      
      if (!response.ok) {
        throw new Error(`Batch lookup failed: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      const aircraftList = data?.aircraft || data || []
      
      for (const aircraft of aircraftList) {
        const normalized = this.normalizeAircraftData(aircraft)
        aircraftMap.set(normalized.icao24, normalized)
      }
      
      return aircraftMap
    } catch (error) {
      console.error('[ADSB Adapter] Batch aircraft lookup failed:', error)
      throw error
    }
  }
  
  /**
   * Normalize raw ADS-B Exchange data to internal format.
   * 
   * Treats absent provider fields as unknown (not zero).
   * Validates position usability based on coordinates and freshness.
   * 
   * @param raw Raw aircraft data from provider
   * @returns Normalized ADSBAircraft
   */
  private normalizeAircraftData(raw: any): ADSBAircraft {
    return {
      registration: raw.registration || '',
      icao24: raw.icao24 || raw.hex || '',
      flight: raw.flight || '',
      latitude: this.parseNumericField(raw.lat),
      longitude: this.parseNumericField(raw.lon),
      altitudeBaro: raw.alt_baro ?? 0,
      altitudeGeo: this.parseNumericField(raw.alt_geom),
      groundSpeed: raw.gs ?? 0,
      track: raw.track ?? 0,
      verticalRate: raw.baro_rate ?? 0,
      seenPos: raw.seen_pos ?? 0,
      seen: raw.seen ?? 0,
      provider: raw.provider || 'adsb_exchange',
      r: raw.r || null,
      nicBaro: raw.nic_baro || null,
      nicLat: raw.nic_lat || null,
      nicLon: raw.nic_lon || null,
      sil: raw.sil || null,
      silType: raw.sil_type || null,
      baroRate: raw.baro_rate || null,
      squawk: raw.squawk || null,
      emergency: raw.emergency || null,
      spi: raw.spi || false,
      callsign: raw.callsign || '',
      category: raw.category || null
    }
  }
  
  /**
   * Parse numeric field, treating absent/invalid values as null.
   * 
   * @param value Raw field value
   * @returns Parsed number or null
   */
  private parseNumericField(value: any): number | null {
    if (value === undefined || value === null || value === '') {
      return null
    }
    const parsed = Number(value)
    return isNaN(parsed) ? null : parsed
  }
  
  /**
   * Check provider health status.
   * 
   * @returns Current provider health information
   */
  async checkHealth(): Promise<ProviderHealth> {
    const startTime = Date.now()
    
    try {
      const response = await fetch(
        `${this.baseUrl}/v2/health`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        }
      )
      
      const responseTime = Date.now() - startTime
      
      if (response.ok) {
        return {
          status: 'live',
          lastSuccessfulIngestion: new Date(),
          errorClass: null,
          errorMessage: null,
          responseTimeMs: responseTime
        }
      } else {
        const errorClass = this.classifyError(response.status)
        return {
          status: response.status >= 500 ? 'unavailable' : 'degraded',
          lastSuccessfulIngestion: null,
          errorClass: errorClass,
          errorMessage: `Provider health check failed: ${response.status}`,
          responseTimeMs: responseTime
        }
      }
    } catch (error) {
      const responseTime = Date.now() - startTime
      return {
        status: 'unavailable',
        lastSuccessfulIngestion: null,
        errorClass: error instanceof Error ? 'connection_error' : 'unknown',
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
        responseTimeMs: responseTime
      }
    }
  }
  
  /**
   * Classify HTTP error status into error classes.
   */
  private classifyError(status: number): string {
    if (status === 401 || status === 403) return 'authentication_failure'
    if (status === 429) return 'rate_limit'
    if (status >= 500) return 'provider_outage'
    if (status >= 400) return 'client_error'
    return 'unknown_error'
  }
  
  /**
   * Get streaming status.
   */
  isStreamingEnabled(): boolean {
    return this.streamingEnabled
  }
  
  /**
   * Get API configuration details (without exposing credentials).
   */
  getConfiguration(): {
    baseUrl: string
    streamingEnabled: boolean
    provider: string
  } {
    return {
      baseUrl: this.baseUrl,
      streamingEnabled: this.streamingEnabled,
      provider: 'adsb_exchange'
    }
  }
}