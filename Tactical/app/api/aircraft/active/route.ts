import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const store = getStore()
  const aircraft = await store.getAircraft()
  return Response.json(aircraft)
}
