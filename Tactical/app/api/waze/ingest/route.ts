import { getStore } from '@/lib/store'
import { constantTimeEqual } from '@/lib/auth/crypto'

export const dynamic = 'force-dynamic'

// Resolve the shared relay secret at request time (not module-eval time).
// Throwing at import broke `next build` page-data collection; instead we
// fail closed here — a missing secret in production rejects every request.
function relaySecret(): string | null {
  // FAIL CLOSED EVERYWHERE. There used to be a `dev-secret` fallback outside
  // production, and that literal was documented in public README/INSTALL files,
  // which made this endpoint's authentication a published constant. A known
  // default on a public ingest route is not authentication — it is feed forgery
  // waiting to happen.
  return process.env.WAZE_RELAY_SECRET ?? null
}

export async function POST(request: Request) {
  // Verify relay secret
  const RELAY_SECRET = relaySecret()
  const secret = request.headers.get('x-relay-secret')
  const src = request.headers.get('x-forwarded-for') || 'lan'
  // Constant-time compare: a plain !== leaks how many leading bytes matched,
  // which is measurable over enough requests against a long shared secret.
  if (!RELAY_SECRET || !constantTimeEqual(String(secret ?? ''), RELAY_SECRET)) {
    console.warn(`[ingest] 401 unauthorized from=${src}`)
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const rawAlerts: any[] = body?.alerts ?? []
    // POLICE + CAMERA. VP-Overwatch carries police sightings and the speed and
    // red-light cameras, which Waze publishes as their own top-level type
    // (`CAMERA`) rather than under POLICE. Filtering strictly on POLICE silently
    // dropped every fixed camera — the permanent ones never expire from the feed,
    // so they were the most reliable thing available and were the only category
    // missing. Jams, hazards, roadworks and closures stay out: this is not a
    // traffic map.
    const KEEP = (t: unknown) => {
      const s = String(t ?? '').toUpperCase()
      return s.startsWith('POLICE') || s === 'CAMERA'
    }

    // Bounds on a service-to-service boundary. The secret authenticates the relay,
    // but a batch is still input: cap how much one request may carry, and drop any
    // alert whose location is not a finite number. A NaN coordinate used to be
    // stored and then drawn, because the store accepts what it is handed.
    const MAX_ALERTS_PER_BATCH = 20_000
    const finiteLoc = (a: any): boolean => {
      const lat = Number(a?.locationY ?? a?.location?.lat ?? a?.latitude)
      const lng = Number(a?.locationX ?? a?.location?.lng ?? a?.longitude)
      return Number.isFinite(lat) && Number.isFinite(lng) &&
             lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    }

    const list = Array.isArray(rawAlerts) ? rawAlerts : []
    if (list.length > MAX_ALERTS_PER_BATCH) {
      console.warn(`[ingest] rejected oversize batch: ${list.length} alerts from=${src}`)
      return Response.json({ error: 'batch too large', max: MAX_ALERTS_PER_BATCH }, { status: 413 })
    }
    const alerts = list.filter((a) => KEEP(a?.type) && finiteLoc(a))
    console.log(`[ingest] ${alerts.length} police+camera / ${list.length} raw from=${src}`)

    if (alerts.length === 0) {
      return Response.json({ ingested: 0, total: list.length })
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
