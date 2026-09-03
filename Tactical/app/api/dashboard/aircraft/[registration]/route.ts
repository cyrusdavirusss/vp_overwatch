/**
 * Specific Aircraft Endpoint
 * 
 * GET /api/dashboard/aircraft/[registration]
 * 
 * Returns detailed state for a specific aircraft.
 * Cache-backed response - no provider call triggered.
 * 
 * Authentication: Required for production deployments
 */

import { NextRequest, NextResponse } from 'next/server'
import { DashboardStore } from '@/lib/adsb/dashboard-store'

export const dynamic = 'force-dynamic'

/**
 * Validate request authentication.
 */
async function validateAuthentication(request: NextRequest): Promise<boolean> {
  const apiKey = request.headers.get('x-api-key')
  return apiKey ? apiKey.length > 0 : false
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registration: string }> }
) {
  try {
    // Validate authentication
    const isAuthenticated = await validateAuthentication(request)
    
    if (!isAuthenticated && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          error: 'authentication_required',
          message: 'API key required. Provide x-api-key header.'
        },
        { 
          status: 401,
          headers: {
            'WWW-Authenticate': 'ApiKey'
          }
        }
      )
    }
    
    const { registration } = await params
    const normalizedReg = registration.trim().toUpperCase()
    
    const store = DashboardStore.getInstance()
    
    if (!store.isInitialized()) {
      return NextResponse.json(
        {
          error: 'service_unavailable',
          message: 'Dashboard store not yet initialized'
        },
        { status: 503 }
      )
    }
    
    const aircraftState = await store.getAircraftState(normalizedReg)
    
    if (!aircraftState) {
      return NextResponse.json(
        {
          error: 'not_found',
          message: `Aircraft registration ${normalizedReg} not found in tracking list`
        },
        { status: 404 }
      )
    }
    
    // Get ICAO24 mapping from persistence
    const persistence = store.getPersistence()
    let icao24Mapping = null
    if (persistence) {
      icao24Mapping = await persistence.loadIcao24Mapping(normalizedReg)
    }
    
    const response = {
      registration: aircraftState.registration,
      description: aircraftState.description,
      icao24: aircraftState.icao24,
      state: aircraftState.state,
      lastObservedAt: aircraftState.lastObservedAt.toISOString(),
      positionFreshnessSeconds: aircraftState.positionFreshnessSeconds,
      latitude: aircraftState.latitude,
      longitude: aircraftState.longitude,
      altitudeMetres: aircraftState.altitudeMetres,
      groundSpeedKt: aircraftState.groundSpeedKt,
      trackDegrees: aircraftState.trackDegrees,
      isPositionUsable: aircraftState.isPositionUsable,
      dataStatus: aircraftState.dataStatus,
      seenPos: aircraftState.seenPos,
      seen: aircraftState.seen,
      eventVersion: aircraftState.eventVersion,
      icao24Mapping: icao24Mapping ? {
        verified: icao24Mapping.verified,
        resolvedAt: icao24Mapping.resolvedAt.toISOString(),
        lastVerifiedAt: icao24Mapping.lastVerifiedAt.toISOString()
      } : undefined
    }
    
    // Remove undefined fields
    if (!response.icao24Mapping) {
      delete response.icao24Mapping
    }
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        'X-State': aircraftState.state,
        'X-Data-Status': aircraftState.dataStatus
      }
    })
  } catch (error) {
    console.error('[Dashboard Aircraft Detail] Error:', error)
    return NextResponse.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve aircraft state'
      },
      { status: 500 }
    )
  }
}