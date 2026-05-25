import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const store = getStore()
  const reports = store.getReports()
  return Response.json(reports)
}
