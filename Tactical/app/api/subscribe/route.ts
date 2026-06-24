import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/subscribe — records a Hermes alert subscriber.
 *
 * IMPORTANT: subscribers are added with consent NOT granted (fail-closed,
 * via the store's default). They are stored but will NOT be called until a
 * proper opt-in grants consent. A web form alone is not provable consent.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phone = String(body.phone || '').trim()
    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }
    const store = getStore()
    const sub = store.addSubscriber(String(body.name || '').trim(), phone, {
      takeoff: body.alertTakeoff !== false,
      stealth: body.alertLostSignal !== false,
      land: body.alertLanding !== false,
    })
    return NextResponse.json({ success: true, id: sub.id, consentPending: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Subscribe failed' }, { status: 500 })
  }
}
