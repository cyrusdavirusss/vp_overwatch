import { getStore } from '@/lib/store'
import { rateLimit, rateLimitIp, clientIp } from '@/lib/auth/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Location set endpoint.
 *
 * Used both for a manual pin from the UI and for the live browser position
 * the client pushes every ~10s. Accepts lat/lng plus optional accuracy and
 * heading; persists into the store's userLocation field (and re-centres the
 * area-wide ADS-B poll on the user).
 *
 * Public by design (visitors are not logged in), so it is rate limited: per-IP
 * where the caller's IP is trustworthy, plus a process-wide ceiling. The per-IP
 * bucket is deliberately inert when no trusted proxy fronts the app (clientIp
 * returns 'untrusted'), so the global bound is what stops a flood from
 * whipsawing the poll centre.
 */
export async function POST(request: Request) {
  try {
    const ipRl = rateLimitIp(clientIp(request.headers), 'gps-set', 120, 60)
    const globalRl = rateLimit('gps-set:global', 3000, 60)
    if (!ipRl.allowed || !globalRl.allowed) {
      return Response.json({ error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(Math.max(ipRl.retryAfterSec, globalRl.retryAfterSec)) } })
    }
    const body = await request.json()
    const lat = Number(body.lat)
    const lng = Number(body.lng)
    const { label } = body

    if (isNaN(lat) || isNaN(lng)) {
      return Response.json({ error: 'Invalid lat/lng' }, { status: 400 })
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return Response.json({ error: 'Coordinates out of range' }, { status: 400 })
    }

    // accuracy defaults to 10m ("locked" GPS) for a manual pin; the live
    // client supplies the real device accuracy/heading.
    const accuracy = body.accuracy != null && !isNaN(Number(body.accuracy)) ? Number(body.accuracy) : 10
    const heading = body.heading != null && !isNaN(Number(body.heading)) ? Number(body.heading) : 0

    const store = getStore()
    store.setUserLocation(lat, lng, accuracy, heading)

    return Response.json({
      status: 'ok',
      lat,
      lng,
      accuracy,
      heading,
      label: label || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
