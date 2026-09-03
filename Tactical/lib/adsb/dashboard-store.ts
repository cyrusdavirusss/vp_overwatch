/**
 * Dashboard Store
 * 
 * Server-side singleton that manages the ADS-B Exchange dashboard state.
 * Integrates with PostgreSQL for durable persistence and Redis for caching.
 * 
 * This store survives hot reloads and container restarts, providing
 * consistent state across multiple instances in production.
 */

import { ADSBExchangeAdapter, RegistrationLookup } from './exchange-adapter'
import { 
  DashboardStateManager, 
  DashboardSnapshot, 
  AircraftState 
} from './dashboard-state-manager'
import { DashboardPersistence } from './persistence/dashboard-persistence'

export class DashboardStore {
  private static instance: DashboardStore | null = null
  
  private adapter: ADSBExchangeAdapter | null = null
  private stateManager: DashboardStateManager | null = null
  private persistence: DashboardPersistence | null = null
  
  private registrations: string[] = []
  private descriptions: Map<string, string> = new Map()
  private initialized: boolean = false
  
  private constructor() {
    // Private constructor for singleton pattern
  }
  
  /**
   * Get the singleton instance.
   */
  static getInstance(): DashboardStore {
    if (!DashboardStore.instance) {
      DashboardStore.instance = new DashboardStore()
    }
    return DashboardStore.instance
  }
  
  /**
   * Initialize the dashboard store with configuration.
   * 
   * This method should be called once during application startup.
   * It initializes the adapter, state manager, and persistence layer.
   * 
   * @param registrations Array of aircraft registrations to track
   * @param descriptions Map of registration to description
   */
  async initialize(
    registrations: string[],
    descriptions: Map<string, string>
  ): Promise<void> {
    if (this.initialized) {
      console.log('[Dashboard Store] Already initialized, skipping re-initialization')
      return
    }
    
    this.registrations = registrations
    this.descriptions = descriptions
    
    // Initialize persistence layer
    const connectionString = process.env.DASHBOARD_DATABASE_URL || 
      process.env.DATABASE_URL || 
      'postgresql://localhost:5432/vp_overwatch'
    
    this.persistence = new DashboardPersistence(connectionString)
    await this.persistence.initialize()
    
    // Load existing state from persistence
    await this.loadFromPersistence()
    
    // Initialize adapter
    const apiKey = process.env.ADSB_EXCHANGE_API_KEY
    if (!apiKey) {
      throw new Error('ADSB_EXCHANGE_API_KEY environment variable is required')
    }
    this.adapter = new ADSBExchangeAdapter(apiKey)
    
    // Initialize state manager
    this.stateManager = new DashboardStateManager(registrations, descriptions)
    await this.stateManager.initialize(registrations, descriptions)
    
    // Resolve ICAO24 mappings for all registrations
    await this.resolveIcao24Mappings()
    
    this.initialized = true
    console.log('[Dashboard Store] Initialization complete')
  }
  
  /**
   * Load existing state from persistence.
   */
  private async loadFromPersistence(): Promise<void> {
    if (!this.persistence) return
    
    try {
      const existingState = await this.persistence.loadAllAircraftState()
      const mappings = await Promise.all(
        this.registrations.map(reg => 
          this.persistence?.loadIcao24Mapping(reg)
        )
      )
      
      console.log(
        `[Dashboard Store] Loaded ${existingState.length} aircraft states from persistence`
      )
    } catch (error) {
      console.error('[Dashboard Store] Error loading from persistence:', error)
    }
  }
  
  /**
   * Resolve ICAO24 mappings for all tracked registrations.
   * 
   * This method queries ADS-B Exchange for each registration and
   * persists the verified mappings.
   */
  private async resolveIcao24Mappings(): Promise<void> {
    if (!this.adapter || !this.persistence) return
    
    for (const registration of this.registrations) {
      try {
        const mapping = await this.adapter.resolveRegistration(registration)
        
        if (mapping.verified && mapping.icao24) {
          await this.persistence.saveIcao24Mapping({
            registration: mapping.registration,
            icao24: mapping.icao24,
            verified: mapping.verified,
            resolvedAt: mapping.resolvedAt,
            lastVerifiedAt: new Date()
          })
          
          console.log(
            `[Dashboard Store] Resolved ${registration} -> ${mapping.icao24}`
          )
        }
      } catch (error) {
        console.error(
          `[Dashboard Store] Failed to resolve ${registration}:`,
          error
        )
      }
    }
  }
  
  /**
   * Get cached dashboard snapshot.
   * 
   * This method returns the cached state without triggering a provider call.
   * It is the primary method for dashboard endpoints.
   * 
   * @returns Current dashboard snapshot
   */
  async getCachedSnapshot(): Promise<DashboardSnapshot> {
    if (!this.stateManager) {
      throw new Error('Dashboard store not initialized')
    }
    return this.stateManager.getCachedSnapshot()
  }
  
  /**
   * Get aircraft state by registration.
   * 
   * @param registration Aircraft registration
   * @returns Aircraft state or undefined
   */
  async getAircraftState(registration: string): Promise<any | undefined> {
    if (!this.stateManager) {
      throw new Error('Dashboard store not initialized')
    }
    return this.stateManager.getAircraftState(registration)
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
   * Get provider configuration (without exposing credentials).
   */
  getProviderConfiguration(): {
    provider: string
    baseUrl: string
    streamingEnabled: boolean
  } | null {
    if (!this.adapter) return null
    return this.adapter.getConfiguration()
  }
  
  /**
   * Check if the store is initialized.
   */
  isInitialized(): boolean {
    return this.initialized
  }
  
  /**
   * Get state manager instance (for ingestion worker).
   */
  getStateManager(): DashboardStateManager | null {
    return this.stateManager
  }
  
  /**
   * Get adapter instance (for ingestion worker).
   */
  getAdapter(): ADSBExchangeAdapter | null {
    return this.adapter
  }
  
  /**
   * Get persistence instance.
   */
  getPersistence(): DashboardPersistence | null {
    return this.persistence
  }
  
  /**
   * Shutdown the dashboard store.
   */
  async shutdown(): Promise<void> {
    if (this.persistence) {
      await this.persistence.close()
    }
    this.initialized = false
    console.log('[Dashboard Store] Shutdown complete')
  }
}

/**
 * Initialize the dashboard with tracked aircraft.
 * 
 * This is the primary entry point for dashboard initialization.
 * Call this during application startup.
 * 
 * @param registrations Array of aircraft registrations
 * @param descriptions Map of registration to description
 */
export async function initializeDashboard(
  registrations: string[],
  descriptions: Map<string, string>
): Promise<void> {
  const store = DashboardStore.getInstance()
  await store.initialize(registrations, descriptions)
}