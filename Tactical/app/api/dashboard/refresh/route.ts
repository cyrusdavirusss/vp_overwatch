/**
 * Dashboard API Route - Refresh
 * 
 * POST /api/dashboard/refresh
 * 
 * Triggers a fresh state update from ADS-B Exchange.
 * Returns the updated snapshot.
 */

import { NextResponse } from 'next/server'
import { refreshDashboardState } from '@/lib/adsb/dashboard-store'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    console.log('[Dashboard API] Triggering state refresh from ADS-B Exchange...')
    
    const startTime = Date.now()
    const snapshot = await refreshDashboardState()
    const refreshDuration = Date.now() - startTime
    
    console.log(`[Dashboard API] Refresh completed in ${refreshDuration}ms`)
    
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Provider-Status': snapshot.providerStatus,
        'X-Source-Latency-Sec': String(snapshot.sourceLatencySeconds),
        'X-Refresh-Duration-Ms': String(refreshDuration)
      }
    })
  } catch (error) {
    console.error('[Dashboard API] Refresh error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to refresh dashboard state',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}