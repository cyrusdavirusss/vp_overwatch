import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const history = getStore().getSortieHistory()
  // no-store, matching the sky feed. This is a movement history that changes as
  // sorties end, so a cached copy handed to the next caller is a stale picture
  // presented as current — and it is the one route on this app with no cache
  // directive at all.
  return Response.json(history, {
    headers: { 'cache-control': 'no-store' },
  })
}
