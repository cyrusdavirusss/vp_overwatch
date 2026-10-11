/** GET /api/alerts — the caller's own event + delivery history only. */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse } from '@/lib/auth/middleware'
import { listUserEvents, listUserDeliveries } from '@/lib/alerts/store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const [events, deliveries] = await Promise.all([
    listUserEvents(auth.userId), listUserDeliveries(auth.userId),
  ])
  return NextResponse.json({ events, deliveries }, { headers: { 'Cache-Control': 'private, no-store' } })
}
