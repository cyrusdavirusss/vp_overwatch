/**
 * Dashboard Health Endpoint
 * 
 * GET /api/dashboard/health
 * 
 * Returns dashboard health and provider connectivity status.
 * No authentication required for health checks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { DashboardStore } from '@/lib/adsb/dashboard-store'

export async function GET(request: NextRequest) {
  try {
    const store = DashboardStore.getInstance()
    
    if (!store.isInitialized()) {
      return NextResponse.json(
        {
          status: 'uninitialized',
          message: 'Dashboard store not yet initialized',
          timestamp: new Date().toISOString()
        },
        { status: 503 }
      )
    }
    
    const snapshot = await store.getCachedSnapshot()
    const config = store.getProviderConfiguration()
    
    const response = {
      status: 'healthy',
      provider: {
        name: 'ADS-B Exchange',
        status: snapshot.providerStatus,
        latencySeconds: snapshot.sourceLatencySeconds,
        lastUpdate: snapshot.lastUpdate.toISOString(),
        ingestionMode: snapshot.ingestionMode,
        lastIngestionAt: snapshot.lastIngestionAt.toISOString()
      },
      dashboard: {
        trackedAircraftCount: store.getTrackedAircraftCount(),
        trackedRegistrations: store.getTrackedRegistrations(),
        lastStateUpdate: snapshot.lastUpdate.toISOString()
      },
      configuration: config ? {
        baseUrl: config.baseUrl,
        streamingEnabled: config.streamingEnabled
      } : undefined,
      timestamp: new Date().toISOString()
    }
    
    // Remove undefined fields
    if (!response.configuration) {
      delete response.configuration
    }
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        'X-Provider-Status': snapshot.providerStatus,
        'X-Source-Latency-Sec': String(snapshot.sourceLatencySeconds)
      }
    })
  } catch (error) {
    console.error('[Dashboard Health] Error:', error)
    return NextResponse.json(
      {
        status: 'error',
        message: 'Failed to retrieve dashboard health',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}