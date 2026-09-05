/**
 * GET /api/dashboard/health — DETAILED provider/worker health. Admin only.
 * Requires x-admin-token === ADMIN_TOKEN (server-only). Never public: it would
 * otherwise leak base URL, tracked registrations, and provider timings.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getDashboardSnapshot } from '@/lib/adsb/dashboard-read'
import { trackedRegistrations, ingestionMode } from '@/lib/adsb/config'
import { constantTimeEqual } from '@/lib/auth/crypto'

export const dynamic = 'force-dynamic'

function isAdmin(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected) return false
  const got = req.headers.get('x-admin-token') ?? ''
  return got.length > 0 && constantTimeEqual(got, expected)
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  const snapshot = await getDashboardSnapshot()
  return NextResponse.json({
    status: 'ok',
    provider: {
      status: snapshot.providerStatus,
      lastSuccessfulCycleAt: snapshot.lastSuccessfulCycleAt,
      ingestionMode: ingestionMode(),
    },
    dashboard: {
      trackedRegistrations: trackedRegistrations(),
      count: snapshot.count,
      lastUpdate: snapshot.lastUpdate,
      states: snapshot.aircraft.map((a) => ({ registration: a.registration, state: a.state, dataStatus: a.dataStatus })),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
