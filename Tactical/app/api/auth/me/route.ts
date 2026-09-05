import { NextResponse, type NextRequest } from 'next/server'
import { currentSession } from '@/lib/auth/middleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const s = await currentSession(req)
  if (!s) return NextResponse.json({ user: null }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } })
  return NextResponse.json(
    { user: { id: s.userId, email: s.email }, csrfToken: s.csrfSecret },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
