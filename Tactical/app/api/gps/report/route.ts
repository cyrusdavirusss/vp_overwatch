import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** GPS relay secret for phone-to-server auth */
const GPS_SECRET = process.env.GPS_RELAY_SECRET ?? (process.env.NODE_ENV === 'development' ? 'gps-dev' : null)
if (!GPS_SECRET) throw new Error('GPS_RELAY_SECRET env var is required in production')

export async function POST(request: Request) {
  const secret = request.headers.get('x-gps-secret')
  if (secret !== GPS_SECRET) {
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
