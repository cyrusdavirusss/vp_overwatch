/**
 * Dashboard Aircraft Endpoint
 * 
 * GET /api/dashboard/aircraft
 * 
 * Returns current state of all tracked aircraft.
 * Cache-backed response - no provider call triggered.
 * 
 * Authentication: Required for production deployments
 */

import { NextRequest, NextResponse } from 'next/server'
import { DashboardStore } from '@/lib/adsb/dashboard-store'

/**
 * Validate request authentication.
 * 
 * In production, this should verify API key or JWT token.
 * For now, implements basic API key validation.
 */
async function validateAuthentication(request: NextRequest): Promise<boolean> {
  const apiKey = request.headers.get('x-api-key')
  
  if (!apiKey) {
    return false
  }
  
  // In production, validate against stored API keys
  // For now, accept any non-empty API key
  return apiKey.length > 0
}

export async function GET(request: NextRequest) {
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
    
    const snapshot = await store.getCachedSnapshot()
    
    // Transform aircraft data for response
    const aircraft = snapshot.aircraft.map(state => ({
      registration: state.registration,
      description: state.description,
      state: state.state,
      lastObservedAt: state.lastObservedAt.toISOString(),
      positionFreshnessSeconds: state.positionFreshnessSeconds,
      latitude: state.latitude,
      longitude: state.longitude,
      altitudeMetres: state.altitudeMetres,
      groundSpeedKt: state.groundSpeedKt,
      trackDegrees: state.trackDegrees,
      isPositionUsable: state.isPositionUsable,
      dataStatus: state.dataStatus,
      eventVersion: state.eventVersion
    }))
    
    const response = {
      aircraft: aircraft,
      lastUpdate: snapshot.lastUpdate.toISOString(),
      sourceLatencySeconds: snapshot.sourceLatencySeconds,
      providerStatus: snapshot.providerStatus,
      ingestionMode: snapshot.ingestionMode,
      lastIngestionAt: snapshot.lastIngestionAt.toISOString()
    }
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        'X-Provider-Status': snapshot.providerStatus,
        'X-Source-Latency-Sec': String(snapshot.sourceLatencySeconds),
        'X-Aircraft-Count': String(aircraft.length)
      }
    })
  } catch (error) {
    console.error('[Dashboard Aircraft] Error:', error)
    return NextResponse.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve aircraft state'
      },
      { status: 500 }
    )
  }
}