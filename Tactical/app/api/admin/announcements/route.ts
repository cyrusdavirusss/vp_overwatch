/**
 * /api/admin/announcements — authoring surface.
 *
 *   GET    list every announcement (including withdrawn/expired) + delivery tallies
 *   POST   create one and fan it out to push subscribers
 *   DELETE ?id=N   withdraw one (soft delete: the audit trail stays)
 *
 * AUTH: this app has users and sessions but no role flag, so authoring is gated by a
 * single server-side token, VP_ADMIN_TOKEN. It FAILS CLOSED: with no token configured
 * every call is refused and told why, rather than the route defaulting open. A shared
 * token is a weaker control than a role, which is the reason the write surface is kept
 * to this one narrow endpoint instead of being spread across the app.
 *
 * Comparison is timing-safe: a token check that leaks length or prefix through timing
 * is a token check that can be attacked byte by byte.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import {
  createAnnouncement, deliverAnnouncement, deliverySummary, listAllAnnouncements,
  withdrawAnnouncement, type AnnouncementLevel,
} from '@/lib/announcements'

export const dynamic = 'force-dynamic'

const LEVELS: AnnouncementLevel[] = ['info', 'notice', 'warning', 'critical']

function tokenOk(req: NextRequest): { ok: true } | { ok: false; res: NextResponse } {
  const expected = process.env.VP_ADMIN_TOKEN
  if (!expected) {
    return { ok: false, res: NextResponse.json({
      error: 'authoring_disabled',
      reason: 'VP_ADMIN_TOKEN is not set on the server, so announcement authoring is refused. ' +
              'Set it in .env.local and restart the app to enable this endpoint.',
    }, { status: 503 }) }
  }
  const got = req.headers.get('x-admin-token') || ''
  const a = Buffer.from(got), b = Buffer.from(expected)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  if (!ok) return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  return { ok: true }
}

export async function GET(req: NextRequest) {
  const auth = tokenOk(req)
  if (!auth.ok) return auth.res
  const all = await listAllAnnouncements(50)
  const withTallies = await Promise.all(all.map(async (a) => ({
    ...a, deliveries: await deliverySummary(a.id),
  })))
  return NextResponse.json({ announcements: withTallies },
    { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = tokenOk(req)
  if (!auth.ok) return auth.res

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const title = String(body?.title || '').trim()
  const text = String(body?.body || '').trim()
  if (!title || !text) {
    return NextResponse.json({ error: 'title_and_body_required' }, { status: 400 })
  }
  const level: AnnouncementLevel = LEVELS.includes(body?.level) ? body.level : 'info'

  // Hours rather than an absolute date: the caller is usually a human or an agent
  // saying "for the next 6 hours", and that survives clock/timezone mistakes.
  let expiresAt: Date | null = null
  if (typeof body?.expiresInHours === 'number' && body.expiresInHours > 0) {
    expiresAt = new Date(Date.now() + body.expiresInHours * 3600_000)
  }

  try {
    const created = await createAnnouncement({
      title, body: text, level, pinned: body?.pinned === true, expiresAt,
      createdBy: String(body?.createdBy || 'operator').slice(0, 60),
    })
    // Deliver immediately, and report what actually happened rather than assuming.
    const deliveries = await deliverAnnouncement(created)
    return NextResponse.json({ announcement: created, deliveries }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'create_failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = tokenOk(req)
  if (!auth.ok) return auth.res
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'id_required' }, { status: 400 })
  }
  const withdrawn = await withdrawAnnouncement(id)
  if (!withdrawn) return NextResponse.json({ error: 'not_found_or_already_withdrawn' }, { status: 404 })
  return NextResponse.json({ announcement: withdrawn })
}
