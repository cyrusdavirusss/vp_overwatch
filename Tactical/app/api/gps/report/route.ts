import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** GPS relay secret for phone-to-server auth. Resolved per-request (not at
 *  module-eval) so a missing secret fails closed instead of breaking the build. */
function gpsSecret(): string | null {
  return process.env.GPS_RELAY_SECRET ?? (process.env.NODE_ENV !== 'production' ? 'gps-dev' : null)
}

export async function POST(request: Request) {
  const GPS_SECRET = gpsSecret()
  const secret = request.headers.get('x-gps-secret')
  if (!GPS_SECRET || secret !== GPS_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { lat, lng, hdg, accuracy } = body

    if (lat == null || lng == null) {
      return Response.json({ error: 'lat and lng required' }, { status: 400 })
    }

    const store = getStore()
    store.setGPS(Number(lat), Number(lng), Number(hdg ?? 0), Number(accuracy ?? 25))

    return Response.json({ status: 'ok' })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
