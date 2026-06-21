import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * Location set endpoint.
 *
 * Used both for a manual pin from the UI and for the live browser position
 * the client pushes every ~10s. Accepts lat/lng plus optional accuracy and
 * heading; persists into the store's userLocation field (and re-centres the
 * area-wide ADS-B poll on the user).
 */
export async function POST(request: Request) {
  try {
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
