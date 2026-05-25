import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const store = getStore()
  const gps = store.getGPS()
  return Response.json(gps)
}
