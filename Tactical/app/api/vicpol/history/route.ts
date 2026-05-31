import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const history = getStore().getSortieHistory()
  return Response.json(history)
}
