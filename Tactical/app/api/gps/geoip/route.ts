import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * IP Geolocation endpoint.
 *
 * Resolves the caller's approximate location from their IP address using
 * ip-api.com (free, no key). Stores the result in the server-side GPS
 * position so the GPS poll picks it up automatically.
 *
 * Fallback: returns Melbourne CBD if geo lookup fails.
 */
export async function GET(request: Request) {
  const store = getStore()

  // Get the client's real IP from headers
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const clientIp = forwarded?.split(',')[0]?.trim() || realIp || ''

  // If there's already a real browser-GPS lock (not the mock default), return that
  const current = store.getGPS()
  const isDefault =
    Math.abs(current.lat - (-37.8136)) < 0.001 &&
    Math.abs(current.lng - 144.9631) < 0.001
  if (!isDefault && current.accuracy < 100) {
    return Response.json({ ...current, source: 'gps' })
  }

  try {
    // Query ip-api.com — returns lat/lon from IP (free, 45 req/min)
    const queryIp = clientIp || ''
    const url = queryIp
      ? `http://ip-api.com/json/${queryIp}?fields=status,lat,lon,city,query`
      : `http://ip-api.com/json/?fields=status,lat,lon,city,query`

    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    const data = await res.json()

    if (data.status === 'success') {
      const geo: typeof current & { source: string } = {
        lat: data.lat,
        lng: data.lon,
        hdg: 0,
        accuracy: 5000, // IP geo is ~5km accurate
        source: 'ipgeo',
      }

      // Only overwrite if the current position is still the mock default
      if (Math.abs(current.lat - (-37.8136)) < 0.001 &&
          Math.abs(current.lng - 144.9631) < 0.001) {
        store.setGPS(geo.lat, geo.lng, geo.hdg, geo.accuracy)
      }

      return Response.json(geo)
    }
  } catch {
    // Fall through to default
  }

  return Response.json({ ...current, source: 'fallback' })
}
