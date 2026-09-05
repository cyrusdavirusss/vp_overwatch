import { TRACKED_AIRCRAFT } from '../lib/adsb/config.ts'
import { emptyRecord, applyObservation, type ApplyContext } from '../lib/adsb/state-machine.ts'
import * as P from '../lib/adsb/persistence/dashboard-persistence.ts'
import type { ADSBAircraft } from '../lib/adsb/exchange-adapter.ts'
import { getPool, query } from '../lib/db/pool.ts'

const ctx: ApplyContext = { nowMs: Date.now(), providerNowMs: Date.now(), providerHealthy: true,
  freshness: { freshSeconds: 60, unavailableSeconds: 300 },
  movement: { airborneAltFt: 400, groundAltFt: 150, airborneSpeedKt: 40, groundSpeedKt: 20, confirmObservations: 2 } }

function ok(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1) } else console.log('ok -', msg) }

await P.ensureRoster(TRACKED_AIRCRAFT)
let recs = await P.loadAllRecords()
ok(recs.size === 4, `roster seeded 4 rows (got ${recs.size})`)
ok(recs.get('VH-PVO')!.altitudeMetres === null, 'seeded telemetry is NULL not 0')

// Apply two airborne observations to VH-PVO → confirmed airborne + takeoff event.
const obs = (p: Partial<ADSBAircraft>): ADSBAircraft => ({ icao24:'7c6db8', registration:'VH-PVO', callsign:null,
  latitude:-37.8, longitude:144.9, onGround:false, altitudeBaro:1500, altitudeGeo:null, groundSpeed:90, track:180,
  verticalRate:null, seenPos:2, seen:1, squawk:null, emergency:null, provider:'adsb_exchange', ...p })
let rec = emptyRecord('VH-PVO','AW139', ctx.nowMs)
let step = applyObservation(rec, obs({}), { ...ctx, nowMs: ctx.nowMs+1000 }); rec = step.record
step = applyObservation(rec, obs({}), { ...ctx, nowMs: ctx.nowMs+2000 }); rec = step.record
await P.upsertRecord(rec)
const ev = step.events.find(e => e.eventType==='takeoff')!
ok(!!ev, 'takeoff event produced')
// Self-clean: event dedup keys are deterministic (icao:takeoff:seq), so a prior
// run would otherwise poison the first-insert assertion. Removing it also proves
// the key is stable/replay-safe (not Date.now()-based).
await query('DELETE FROM aircraft_events WHERE dedup_key = $1', [ev.dedupKey])
ok(await P.insertEventIfNew(ev) === true, 'event inserted first time')
ok(await P.insertEventIfNew(ev) === false, 'duplicate event NOT inserted (idempotent)')

recs = await P.loadAllRecords()
ok(recs.get('VH-PVO')!.confirmedMovement === 'airborne', 'hydrated state = airborne')
ok(recs.get('VH-PVO')!.altitudeMetres !== null, 'hydrated altitude present after upsert')

await P.saveMapping('VH-PVO','7c6db8','verified')
const m = await P.loadMapping('VH-PVO')
ok(m?.icao24 === '7c6db8' && m?.status === 'verified', 'mapping persisted+verified')

await P.recordIngestionRun({ mode:'rest', success:true, aircraftCount:4, sourceLatencyMs:120, lastSuccessfulCycleAt: Date.now() })
ok(typeof (await P.lastSuccessfulCycleAt()) === 'number', 'lastSuccessfulCycleAt returns ms')

await getPool().end()
console.log('SMOKE PASS')
