import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

const RELAY_SECRET = process.env.WAZE_RELAY_SECRET || 'dev-secret'

export async function POST(request: Request) {
  // Verify relay secret
  const secret = request.headers.get('x-relay-secret')
  if (secret !== RELAY_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const alerts: any[] = body?.alerts ?? []

    if (!Array.isArray(alerts) || alerts.length === 0) {
      return Response.json({ ingested: 0 })
    }

    const store = getStore()
    let count = 0

    for (const alert of alerts) {
      store.upsertAlert(alert)
      count++
    }

    store.updateRelayAfterIngest(count, alerts.length)

    return Response.json({ ingested: count, total: alerts.length })
  } catch (err: any) {
    console.error('[ingest] error:', err.message)
    return Response.json({ error: err.message }, { status: 400 })
  }
}
