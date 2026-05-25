import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ status: 'ok' })
}
