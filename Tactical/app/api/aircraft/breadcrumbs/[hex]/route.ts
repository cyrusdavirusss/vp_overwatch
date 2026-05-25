import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hex: string }> }
) {
  const { hex } = await params
  const store = getStore()
  const breadcrumbs = store.getBreadcrumbs(hex.toUpperCase())

  return Response.json(breadcrumbs)
}
