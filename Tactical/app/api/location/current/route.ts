/**
 * POST /api/location/current — authenticated user submits their current device
 * location (explicit consent implied by the client opt-in). Server validates,
 * stores ONLY the latest with a short expiry, evaluates proximity, and returns
 * the caller's own alert status. Never reveals location to other users.
 * GET returns the caller's current stored location/alert status.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isResponse, checkCsrf } from '@/lib/auth/middleware'
import { setUserLocation, getUserLocation } from '@/lib/alerts/store'
import { evaluateProximityForUser } from '@/lib/alerts/engine'
import { loadAllRecords } from '@/lib/adsb/persistence/dashboard-persistence'

export const dynamic = 'force-dynamic'

function validCoord(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const csrf = checkCsrf(req, auth)
  if (csrf) return csrf

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  const { lat, lng, accuracy } = body ?? {}
  if (!validCoord(lat, lng)) return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 })

  const loc = await setUserLocation(auth.userId, lat, lng, typeof accuracy === 'number' ? accuracy : null)
  const records = [...(await loadAllRecords()).values()]
  const fired = await evaluateProximityForUser(loc, records)

  return NextResponse.json(
    { status: 'active', updatedAt: new Date(loc.updatedAt).toISOString(),
      expiresAt: new Date(loc.expiresAt).toISOString(),
      proximityEvents: fired.map((e) => ({ registration: e.registration, message: e.message, occurredAt: new Date(e.occurredAt).toISOString() })) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (isResponse(auth)) return auth
  const loc = await getUserLocation(auth.userId)
  if (!loc) return NextResponse.json({ status: 'no_location' }, { headers: { 'Cache-Control': 'private, no-store' } })
  return NextResponse.json(
    { status: 'active', lat: loc.lat, lng: loc.lng, accuracy: loc.accuracyM,
      updatedAt: new Date(loc.updatedAt).toISOString(), expiresAt: new Date(loc.expiresAt).toISOString() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
