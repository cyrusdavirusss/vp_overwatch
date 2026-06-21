import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const store = getStore()
  // Prefer the live browser-pushed position; fall back to the GPS default
  // so the endpoint always returns a usable point.
  const userLocation = store.getUserLocation()
  if (userLocation) return Response.json(userLocation)
  return Response.json(store.getGPS())
}
