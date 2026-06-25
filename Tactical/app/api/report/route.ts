import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

const VALID = ['marked', 'unmarked', 'hidden'] as const
type Kind = (typeof VALID)[number]

/** POST /api/report — user-submitted ("VPS") ground hazard report. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { kind, lat, lng } = body
    if (!VALID.includes(kind as Kind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat/lng required' }, { status: 400 })
    }
    getStore().addUserReport(kind as Kind, lat, lng, String(body.sessionId || ''))
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Report failed' }, { status: 500 })
  }
}
