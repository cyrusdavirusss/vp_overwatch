/**
 * VP Overwatch — Waze CDP data collection worker
 * ────────────────────────────────────────────────────────────────────────────
 * Standalone supervised process that collects real-time traffic data from Waze
 * via Chrome DevTools Protocol. Runs independently from the Next.js app,
 * holding a Postgres advisory lease for single-writer coordination.
 *
 * Connects to Waze browser instance on Windows desktop (100.80.115.26:9222),
 * implements rate limiting, detection evasion, and circuit breaker resilience.
 *
 * Run:  WAZE_CDP_ENDPOINT=ws://100.80.115.26:9222/devtools/page \
 *       DATABASE_URL=... \
 *       node --experimental-strip-types scripts/waze-cdp-ingest.ts
 *
 * Environment:
 *   WAZE_CDP_ENDPOINT     - CDP WebSocket endpoint (default: ws://100.80.115.26:9222/devtools/page)
 *   WAZE_CDP_INTERVAL_MS  - Collection interval in milliseconds (default: 15000)
 *   WAZE_RATE_LIMIT_RPS   - Rate limit requests per second (default: 30)
 *   WAZE_FINGERPRINT_ROTATION_MS - Fingerprint rotation interval (default: 300000)
 *   WAZE_FAKE             - If '1', runs in simulation mode without network calls
 */

import { WazeCdpAdapter, createDefaultWazeCdpAdapter, type WazeAlert, type WazeJam, type CollectionMetrics } from '../lib/waze-cdp/waze-cdp-adapter.ts'
import { getStore } from '../lib/store.ts'
import { acquireIngestLease } from '../lib/db/lease.ts'
import { getPool } from '../lib/db/pool.ts'
import * as P from '../lib/adsb/persistence/dashboard-persistence.ts'

const log = (...a: unknown[]) => console.log('[waze-cdp-ingest]', ...a)

function readConfig(): {
  endpoint: string
  collectionIntervalMs: number
  rateLimitRps: number
  fingerprintRotationMs: number
  fakeMode: boolean
} {
  return {
    endpoint: process.env.WAZE_CDP_ENDPOINT ?? 'ws://100.80.115.26:9222/devtools/page',
    collectionIntervalMs: Number(process.env.WAZE_CDP_INTERVAL_MS ?? 15_000),
    rateLimitRps: Number(process.env.WAZE_RATE_LIMIT_RPS ?? 30),
    fingerprintRotationMs: Number(process.env.WAZE_FINGERPRINT_ROTATION_MS ?? 300_000),
    fakeMode: process.env.WAZE_FAKE === '1',
  }
}

async function publishCollectedData(
  adapter: WazeCdpAdapter,
  store: ReturnType<typeof getStore>,
): Promise<void> {
  const alerts = adapter.getAlerts()
  const jams = adapter.getJams()

  let newAlertCount = 0
  for (const alert of alerts) {
    const rawAlert = {
      uuid: alert.wazeUuid,
      type: alert.type,
      subtype: alert.subtype,
      location: { x: alert.lng, y: alert.lat },
      street: alert.street,
      city: alert.city,
      reliability: alert.reliability,
      confidence: alert.confidence,
      nThumbsUp: alert.nThumbsUp,
      pubMillis: Date.now() - alert.reportedAgo * 1000,
      description: alert.descr,
      source: alert.source,
      cdpCollectedAt: alert.cdpCollectedAt,
      boundingBoxId: alert.boundingBoxId,
      fingerprintId: alert.fingerprintId,
    }

    const isNew = store.upsertAlert(rawAlert)
    if (isNew) newAlertCount++
  }

  if (newAlertCount > 0 || jams.length > 0) {
    store.updateRelayAfterIngest(newAlertCount, alerts.length)
    log(`published ${newAlertCount} new alerts, ${jams.length} jams`)
  }

  adapter.clearCollectedData()
}

async function recordCollectionMetrics(
  metrics: CollectionMetrics,
  rateLimitState: any,
  circuitBreakerState: any,
): Promise<void> {
  await P.recordIngestionRun({
    mode: 'waze_cdp',
    success: metrics.failedRequests === 0,
    aircraftCount: metrics.alertsCollected + metrics.jamsCollected,
    sourceLatencyMs: metrics.averageResponseTimeMs,
    lastSuccessfulCycleAt: metrics.lastCollectionAt ?? Date.now(),
    extra: {
      waze: {
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        throttledRequests: metrics.throttledRequests,
        circuitOpens: metrics.circuitOpens,
        boundingBoxesCovered: metrics.boundingBoxesCovered,
        alertsCollected: metrics.alertsCollected,
        jamsCollected: metrics.jamsCollected,
        rateLimit: {
          tokens: rateLimitState.tokens,
          throttledCount: rateLimitState.throttledCount,
          requestsThisWindow: rateLimitState.requestsThisWindow,
        },
        circuitBreaker: {
          state: circuitBreakerState.state,
          failureCount: circuitBreakerState.failureCount,
          consecutiveFailures: circuitBreakerState.failureCount,
        },
      },
    },
  })
}

async function main(): Promise<void> {
  const config = readConfig()
  log(
    `starting (endpoint=${config.endpoint}, interval=${config.collectionIntervalMs}ms, ` +
    `rateLimit=${config.rateLimitRps} RPS, fingerprintRotation=${config.fingerprintRotationMs}ms, ` +
    `fake=${config.fakeMode})`,
  )

  const lease = await acquireIngestLease()
  if (!lease) {
    log('another ingester holds the lease; exiting')
    await getPool().end()
    process.exit(0)
  }
  log('acquired ingest lease')

  const adapter = config.fakeMode
    ? createDefaultWazeCdpAdapter()
    : createDefaultWazeCdpAdapter()

  await adapter.initialize()
  log('Waze CDP adapter initialized')

  const store = getStore()
  let stopping = false

  const shutdown = async (sig: string) => {
    if (stopping) return
    stopping = true
    log(`received ${sig}, shutting down`)

    const metrics = adapter.getMetrics()
    const rateLimitState = adapter.getRateLimitState()
    const circuitBreakerState = adapter.getCircuitBreakerState()

    await publishCollectedData(adapter, store)
    await recordCollectionMetrics(metrics, rateLimitState, circuitBreakerState)

    await adapter.shutdown()
    try { await lease.release() } catch {}
    try { await getPool().end() } catch {}

    log(
      `shutdown complete — total requests: ${metrics.totalRequests}, ` +
      `alerts: ${metrics.alertsCollected}, jams: ${metrics.jamsCollected}`,
    )
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  const oneShot = process.env.WAZE_ONESHOT === '1'
  log('collection loop running')

  if (oneShot) {
    await new Promise((r) => setTimeout(r, config.collectionIntervalMs * 2))
    await shutdown('ONESHOT')
  } else {
    while (!stopping) {
      await new Promise((r) => setTimeout(r, config.collectionIntervalMs))
    }
  }
}

main().catch((e) => {
  console.error('[waze-cdp-ingest] fatal:', e)
  process.exit(1)
})