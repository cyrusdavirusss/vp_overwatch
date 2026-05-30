import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * Manual location override endpoint.
 *
 * Lets the user type in coordinates from the app UI (no GPS required).
 * Accepts lat/lng from POST body, bypasses accuracy checks.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    let { lat, lng, label } = body

    lat = Number(lat)
    lng = Number(lng)

    if (isNaN(lat) || isNaN(lng)) {
      return Response.json({ error: 'Invalid lat/lng' }, { status: 400 })
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return Response.json({ error: 'Coordinates out of range' }, { status: 400 })
    }

    const store = getStore()
    store.setGPS(lat, lng, 0, 10) // accuracy 10m — marks as "locked" GPS

    return Response.json({
      status: 'ok',
      lat,
      lng,
      label: label || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
