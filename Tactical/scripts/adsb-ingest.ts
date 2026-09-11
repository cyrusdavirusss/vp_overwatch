/**
 * VP Overwatch — ADS-B ingestion worker (standalone, supervised process).
 * ────────────────────────────────────────────────────────────────────────────
 * The ONLY component that talks to ADS-B Exchange. Holds a Postgres advisory
 * lease (single active writer), hydrates durable state on boot, resolves
 * registration→hex mappings, then every ADSB_REST_INTERVAL_SECONDS fetches the
 * tracked hexes, applies the state machine, persists state + idempotent events,
 * and evaluates per-user proximity. Never run from a Next request/browser.
 *
 * Run:  DATABASE_URL=... ADSB_EXCHANGE_API_KEY=... \
 *       node --experimental-strip-types scripts/adsb-ingest.ts
 *
 * Test harness: ADSB_FAKE=1 injects a fixture provider (no network / no key) so
 * the full loop can be verified against a scratch database.
 */
import { ADSBExchangeAdapter, type CollectionResult } from '../lib/adsb/exchange-adapter.ts'
import { createProvider, type AircraftProvider } from '../lib/adsb/provider.ts'
import { TRACKED_AIRCRAFT, trackedRegistrations, freshnessConfig, movementConfig, restIntervalSeconds, ingestionMode, adsbProvider, hexOverride } from '../lib/adsb/config.ts'
import { applyObservation, sweepAircraft, emptyRecord, type ApplyContext } from '../lib/adsb/state-machine.ts'
import * as P from '../lib/adsb/persistence/dashboard-persistence.ts'
import { evaluateProximityForUser } from '../lib/alerts/engine.ts'
import { getActiveUserLocations } from '../lib/alerts/store.ts'
import { acquireIngestLease } from '../lib/db/lease.ts'
import { getPool } from '../lib/db/pool.ts'
import type { AircraftRecord } from '../lib/adsb/types.ts'

const log = (...a: unknown[]) => console.log('[adsb-ingest]', ...a)

function buildAdapter(): AircraftProvider {
  if (process.env.ADSB_FAKE === '1') {
    // Fixture provider — returns the tracked hexes as live airborne aircraft.
    const fake = (async (url: any) => {
      const now = Date.now()
      const ac = ['7c6db8', '7c6db9', '7c6dba', '7c6dbb'].map((hex, i) => ({
        hex, r: trackedRegistrations()[i], flight: `PVX${i}`,
        alt_baro: 1500 + i * 100, gs: 90, track: 180, baro_rate: 0,
        lat: -37.8 + i * 0.01, lon: 144.9 + i * 0.01, seen_pos: 2, seen: 1,
      }))
      return { ok: true, status: 200, statusText: 'ok', headers: { get: () => null }, json: async () => ({ now, ac }) } as any
    }) as unknown as typeof fetch
    return new ADSBExchangeAdapter('fake-key', { fetchImpl: fake })
  }
  return createProvider()
}

async function resolveMappings(adapter: AircraftProvider, records: Map<string, AircraftRecord>): Promise<void> {
  for (const reg of trackedRegistrations()) {
    const rec = records.get(reg)
    if (rec && rec.mappingStatus === 'verified' && rec.icao24) continue
    try {
      const lookup = await adapter.resolveRegistration(reg)
      if (lookup.verified && lookup.icao24) {
        await P.saveMapping(reg, lookup.icao24, 'verified')
        if (rec) { rec.icao24 = lookup.icao24; rec.mappingStatus = 'verified'; await P.upsertRecord(rec) }
        log(`resolved ${reg} -> ${lookup.icao24}`)
      } else {
        // Provider can't resolve reg→hex (e.g. OpenSky) → use a configured hex.
        const ov = hexOverride(reg)
        if (ov) {
          await P.saveMapping(reg, ov, 'verified')
          if (rec) { rec.icao24 = ov; rec.mappingStatus = 'verified'; await P.upsertRecord(rec) }
          log(`mapped ${reg} -> ${ov} (hex override)`)
        } else {
          log(`unresolved: ${reg} (no provider match, no ADSB_HEX_ override)`)
        }
      }
    } catch (e) {
      log(`mapping resolve failed for ${reg}:`, (e as Error).message)
    }
  }
}

async function runCycle(adapter: AircraftProvider, records: Map<string, AircraftRecord>): Promise<void> {
  const nowMs = Date.now()
  const fresh = freshnessConfig()
  const move = movementConfig()

  const verified = [...records.values()].filter((r) => r.mappingStatus === 'verified' && r.icao24)
  const icaos = verified.map((r) => r.icao24!) as string[]

  let result: CollectionResult | null = null
  let providerHealthy = false
  const started = Date.now()
  try {
    if (icaos.length > 0) result = await adapter.fetchByIcaos(icaos)
    providerHealthy = true
  } catch (e) {
    providerHealthy = false
    log('provider fetch failed:', (e as Error).message)
    await P.recordIngestionRun({ mode: ingestionMode(), success: false, errorClass: 'provider', errorMessage: (e as Error).message })
    return // do NOT sweep on failure → no false telemetry_not_seen
  }

  const ctxBase: Omit<ApplyContext, 'providerNowMs'> = { nowMs, providerHealthy, freshness: fresh, movement: move }
  const providerNowMs = result?.providerNow ?? nowMs

  for (const rec of records.values()) {
    if (rec.mappingStatus !== 'verified' || !rec.icao24) continue
    const obs = result?.aircraft.get(rec.icao24)
    const ctx: ApplyContext = { ...ctxBase, providerNowMs }
    const out = obs ? applyObservation(rec, obs, ctx) : sweepAircraft(rec, ctx)
    records.set(rec.registration, out.record)
    await P.upsertRecord(out.record)
    for (const ev of out.events) await P.insertEventIfNew(ev)
  }

  await P.recordIngestionRun({
    mode: ingestionMode(), success: true, aircraftCount: result?.aircraft.size ?? 0,
    sourceLatencyMs: Date.now() - started, lastSuccessfulCycleAt: Date.now(),
  })

  // Per-user proximity (delivery flagged off inside the engine).
  try {
    const locs = await getActiveUserLocations()
    const recArr = [...records.values()]
    for (const loc of locs) await evaluateProximityForUser(loc, recArr)
  } catch (e) {
    log('proximity eval error:', (e as Error).message)
  }
}

async function main(): Promise<void> {
  log(`starting (provider=${adsbProvider()}, mode=${ingestionMode()}, interval=${restIntervalSeconds()}s, fake=${process.env.ADSB_FAKE === '1'})`)
  const lease = await acquireIngestLease()
  if (!lease) { log('another ingester holds the lease; exiting'); await getPool().end(); process.exit(0) }
  log('acquired ingest lease')

  await P.ensureRoster(TRACKED_AIRCRAFT)
  const records = await P.loadAllRecords()
  const adapter = buildAdapter()
  await resolveMappings(adapter, records)

  let stopping = false
  const shutdown = async (sig: string) => {
    if (stopping) return
    stopping = true
    log(`received ${sig}, releasing lease`)
    try { await lease.release() } catch {}
    try { await getPool().end() } catch {}
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  const oneShot = process.env.ADSB_ONESHOT === '1'
  // eslint-disable-next-line no-constant-condition
  while (!stopping) {
    try { await runCycle(adapter, records) } catch (e) { log('cycle error:', (e as Error).message) }
    if (oneShot) { await shutdown('ONESHOT'); break }
    await new Promise((r) => setTimeout(r, restIntervalSeconds() * 1000))
  }
}

main().catch((e) => { console.error('[adsb-ingest] fatal:', e); process.exit(1) })
