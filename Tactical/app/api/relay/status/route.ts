import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const store = getStore()
  const relay = store.getRelay()
  return Response.json(relay)
}
