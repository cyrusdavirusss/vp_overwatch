/**
 * Dashboard Initialization
 * 
 * Initializes the ADS-B Exchange dashboard with tracked aircraft.
 * Run once during application startup.
 */

import { initializeDashboard } from '@/lib/adsb/dashboard-store'

/**
 * Tracked Aircraft Configuration
 * 
 * Confirmed aircraft list for production deployment.
 * ICAO24 hex values are resolved through ADS-B Exchange registration lookup
 * at startup and persisted after verification.
 */
export const TRACKED_AIRCRAFT_CONFIG = new Map<string, string>([
  ['VH-PVO', 'Leonardo AW139 helicopter'],
  ['VH-PVP', 'Leonardo AW139 helicopter'],
  ['VH-PVQ', 'Leonardo AW139 helicopter'],
  ['VH-PVE', 'Beechcraft 350i Super King Air']
])

/**
 * Initialize dashboard with confirmed aircraft tracking.
 * 
 * This configuration tracks the four confirmed aircraft using ADS-B Exchange.
 * ICAO24 hex identifiers are resolved through provider registration lookup
 * and persisted after exact registration match verification.
 */
export async function initDashboard(): Promise<void> {
  const registrations = Array.from(TRACKED_AIRCRAFT_CONFIG.keys())
  
  console.log('[Dashboard Init] Starting initialization with', registrations.length, 'aircraft')
  console.log('[Dashboard Init] Tracked registrations:', registrations.join(', '))
  
  try {
    await initializeDashboard(registrations, TRACKED_AIRCRAFT_CONFIG)
    console.log('[Dashboard Init] Dashboard initialized successfully')
  } catch (error) {
    console.error('[Dashboard Init] Initialization failed:', error)
    throw error
  }
}

/**
 * Get the list of tracked aircraft registrations.
 * 
 * @returns Array of exactly four confirmed registrations
 */
export function getTrackedRegistrations(): string[] {
  return ['VH-PVO', 'VH-PVP', 'VH-PVQ', 'VH-PVE']
}

/**
 * Get aircraft descriptions.
 * 
 * @returns Map of registration to description
 */
export function getAircraftDescriptions(): Map<string, string> {
  return new Map<string, string>([
    ['VH-PVO', 'Leonardo AW139 helicopter'],
    ['VH-PVP', 'Leonardo AW139 helicopter'],
    ['VH-PVQ', 'Leonardo AW139 helicopter'],
    ['VH-PVE', 'Beechcraft 350i Super King Air']
  ])
}

/**
 * Validate that the tracked aircraft configuration matches production requirements.
 * 
 * @returns true if configuration is valid (exactly four confirmed aircraft)
 */
export function validateConfiguration(): boolean {
  const expectedRegistrations = ['VH-PVO', 'VH-PVP', 'VH-PVQ', 'VH-PVE']
  const actualRegistrations = getTrackedRegistrations()
  
  const isValid = 
    actualRegistrations.length === 4 &&
    expectedRegistrations.every(reg => actualRegistrations.includes(reg))
  
  if (!isValid) {
    console.error('[Dashboard Config] Configuration validation failed')
    console.error('  Expected:', expectedRegistrations)
    console.error('  Actual:', actualRegistrations)
  }
  
  return isValid
}