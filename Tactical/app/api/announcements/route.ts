/**
 * GET /api/announcements — what the in-app banner reads.
 *
 * Public and briefly cacheable: an announcement is the same for every visitor, so
 * unlike the per-user alert settings this is not private. The short shared cache
 * keeps a public deployment cheap without letting a withdrawn notice linger.
 */
import { NextResponse } from 'next/server'
import { listLiveAnnouncements } from '@/lib/announcements'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const announcements = await listLiveAnnouncements(5)
    return NextResponse.json({ announcements }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    })
  } catch (e: any) {
    // The banner is decoration on top of a working map: a failure here must never
    // take the page down or look like "no announcements" when we simply don't know.
    return NextResponse.json({ announcements: [], error: e?.message || 'unavailable' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } })
  }
}
