import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

// Resolve the shared relay secret at request time (not module-eval time).
// Throwing at import broke `next build` page-data collection; instead we
// fail closed here — a missing secret in production rejects every request.
function relaySecret(): string | null {
  return process.env.WAZE_RELAY_SECRET ?? (process.env.NODE_ENV !== 'production' ? 'dev-secret' : null)
}

export async function POST(request: Request) {
  // Verify relay secret
  const RELAY_SECRET = relaySecret()
  const secret = request.headers.get('x-relay-secret')
  const src = request.headers.get('x-forwarded-for') || 'lan'
  if (!RELAY_SECRET || secret !== RELAY_SECRET) {
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
