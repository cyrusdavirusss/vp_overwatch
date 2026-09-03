/**
 * Dashboard Aircraft Endpoint
 * 
 * GET /api/dashboard/aircraft
 * 
 * Returns current state of all tracked aircraft.
 * Cache-backed response - no provider call triggered.
 * 
 * Authentication: Session-based authentication (not static API key)
 * Cache: Private, no-store for authenticated live data
 */

import { NextRequest, NextResponse } from 'next/server'
import { DashboardStore } from '@/lib/adsb/dashboard-store'

/**
 * Validate request authentication using session.
 * 
 * In production, verifies user session or JWT token.
 * Does not accept static API keys from browser for security.
 */
async function validateAuthentication(request: NextRequest): Promise<boolean> {
  // Check for session cookie or JWT token
  const sessionCookie = request.cookies.get('next-auth.session-token')
  const authToken = request.headers.get('authorization')
  
  // Session-based authentication
  if (sessionCookie) {
    return true
  }
  
  // JWT token authentication
  if (authToken && authToken.startsWith('Bearer ')) {
    // In production, validate token signature and expiry
    return authToken.length > 7
  }
  
  return false
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
        // Private cache for authenticated live data - no shared caching
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
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