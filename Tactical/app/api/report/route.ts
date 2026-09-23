import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/store'
import { rateLimit, rateLimitIp, clientIp } from '@/lib/auth/rate-limit'
import { constantTimeEqual } from '@/lib/auth/crypto'

export const dynamic = 'force-dynamic'

const VALID = ['marked', 'unmarked', 'hidden', 'helicopter'] as const
type Kind = (typeof VALID)[number]

/** POST /api/report — user-submitted ("VPS") ground hazard report. */
export async function POST(req: NextRequest) {
  try {
    // Anonymous write endpoint: limit per source IP where trustworthy, and keep
    // a process-wide ceiling so a flood from spoofed/unknown IPs still cannot
    // fill the report store.
    const ipRl = rateLimitIp(clientIp(req.headers), 'report', 10, 3600)
    const globalRl = rateLimit('report:global', 200, 3600)
    if (!ipRl.allowed || !globalRl.allowed) {
      return NextResponse.json({ error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(Math.max(ipRl.retryAfterSec, globalRl.retryAfterSec)) } })
    }
    const body = await req.json()
    const { kind, lat, lng } = body
    if (!VALID.includes(kind as Kind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat/lng required' }, { status: 400 })
    }

    // ── The privileged kind ────────────────────────────────────────────────
    // A helicopter sighting is the one report published WITHOUT corroboration, on
    // its own authority, because it describes something that may not be on the map
    // at all — an aircraft that has gone dark broadcasts no ADS-B, so a person on
    // the ground is the only sensor that can see it.
    //
    // That makes it a claim every other client will render as fact. Anonymous writes
    // must not be able to make it, so the kind is gated on the admin token, and it
    // FAILS CLOSED: with no token configured on the server, no broadcast at all.
    // Same pattern as /api/admin/announcements.
    let authoritative = false
    if (kind === 'helicopter') {
      const expected = process.env.VP_ADMIN_TOKEN
      if (!expected) {
        return NextResponse.json(
          {
            error: 'unavailable',
            reason: 'VP_ADMIN_TOKEN is not set on the server, so a privileged broadcast is refused.',
          },
          { status: 503 }
        )
      }
      const got = req.headers.get('x-admin-token') || ''
      // Constant-time: a plain `!==` exits at the first differing byte, which is
      // measurable over enough attempts. /api/admin/announcements already compares
      // this way; the two routes share one token.
      if (!constantTimeEqual(got, expected)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      authoritative = true
    }

    const accuracyM =
      typeof body.accuracyM === 'number' && Number.isFinite(body.accuracyM) && body.accuracyM > 0
        ? body.accuracyM
        : undefined

    getStore().addUserReport(kind as Kind, lat, lng, String(body.sessionId || ''), {
      authoritative,
      accuracyM,
    })
    return NextResponse.json({ success: true, authoritative })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Report failed' }, { status: 500 })
  }
}
