import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** Bulk ingest endpoint for Waze relay — accepts array of ground units */
export async function POST(request: Request) {
  try {
    const units = await request.json()
    if (!Array.isArray(units)) {
      return Response.json({ error: 'Expected array of ground units' }, { status: 400 })
    }
    
    const store = getStore()
    const result = store.bulkIngestGroundUnits(units)
    
    return Response.json(result, { status: 200 })
  } catch (error) {
    return Response.json(
      { error: 'Bulk ingest failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}