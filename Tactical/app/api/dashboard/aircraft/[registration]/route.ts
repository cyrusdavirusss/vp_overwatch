/**
 * GET /api/dashboard/aircraft/[registration] — cached state for one allow-listed
 * tracked registration. Verified session required. No provider call.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse } from '@/lib/auth/middleware'
import { getAircraftByRegistration } from '@/lib/adsb/dashboard-read'
import { trackedRegistrations } from '@/lib/adsb/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ registration: string }> }) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const { registration } = await params
  const reg = registration.trim().toUpperCase()
  if (!trackedRegistrations().includes(reg)) {
    return NextResponse.json({ error: 'not_found', message: 'Not a tracked registration.' }, { status: 404 })
  }
  const dto = await getAircraftByRegistration(reg)
  if (!dto) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(dto, { headers: { 'Cache-Control': 'private, no-store' } })
}
