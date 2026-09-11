/**
 * GET /api/dashboard/aircraft — cached normalized state for all tracked
 * aircraft. Verified session required. No provider call. Private, no-store.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse } from '@/lib/auth/middleware'
import { getDashboardSnapshot } from '@/lib/adsb/dashboard-read'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  try {
    const snapshot = await getDashboardSnapshot()
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    console.error('[dashboard/aircraft]', e)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
