import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

const RELAY_SECRET = process.env.WAZE_RELAY_SECRET || 'dev-secret'

export async function POST(request: Request) {
  // Verify relay secret
  const secret = request.headers.get('x-relay-secret')
  const src = request.headers.get('x-forwarded-for') || 'lan'
  if (secret !== RELAY_SECRET) {
    console.warn(`[ingest] 401 unauthorized from=${src}`)
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const alerts: any[] = body?.alerts ?? []
    console.log(`[ingest] ${alerts.length} alerts from=${src}`)

    if (!Array.isArray(alerts) || alerts.length === 0) {
      return Response.json({ ingested: 0 })
    }

    const store = getStore()
    let newCount = 0

    for (const alert of alerts) {
      const isNew = store.upsertAlert(alert)
      if (isNew) newCount++
    }

    store.updateRelayAfterIngest(newCount, alerts.length)

    return Response.json({ ingested: newCount, total: alerts.length })
  } catch (err: any) {
    console.error('[ingest] error:', err.message)
    return Response.json({ error: err.message }, { status: 400 })
  }
}
