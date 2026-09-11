import { getPool } from '../lib/db/pool.ts'
import { createUser, verifyLogin } from '../lib/auth/users.ts'
import { createSession, getSession, destroySession } from '../lib/auth/session.ts'
import { setUserLocation } from '../lib/alerts/store.ts'
import { evaluateProximityForUser } from '../lib/alerts/engine.ts'
import { loadAllRecords, upsertRecord } from '../lib/adsb/persistence/dashboard-persistence.ts'
import { emptyRecord } from '../lib/adsb/state-machine.ts'
import { listUserEvents } from '../lib/alerts/store.ts'

function ok(c: boolean, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1) } console.log('ok -', m) }
const email = `t${Date.now()}@example.com`

// Auth
const { user, error } = await createUser(email, 'a-strong-password-123')
ok(!!user && !error, 'createUser succeeds')
ok((await createUser(email, 'a-strong-password-123')).error?.includes('already exists') === true, 'duplicate email rejected')
ok((await verifyLogin(email, 'wrong-password-xyz')) === null, 'bad password rejected')
ok((await verifyLogin(email, 'a-strong-password-123'))?.email === email, 'correct password accepted')

// Session
const { token, csrfSecret } = await createSession(user!.id)
const sess = await getSession(token)
ok(sess?.userId === user!.id, 'session verifies from token')
ok(sess?.csrfSecret === csrfSecret, 'csrf secret round-trips')
ok((await getSession('deadbeef')) === null, 'forged token rejected')

// Proximity: place a live airborne aircraft ~10km from the user → should fire.
const rec = emptyRecord('VH-PVO', 'AW139', Date.now())
rec.icao24 = '7c6db8'; rec.mappingStatus = 'verified'; rec.state = 'live_airborne'
rec.confirmedMovement = 'airborne'; rec.latitude = -37.80; rec.longitude = 144.90
rec.trackDegrees = 90; rec.groundSpeedKt = 120; rec.lastObservedAt = Date.now(); rec.isPositionUsable = true
await upsertRecord(rec)
const loc = await setUserLocation(user!.id, -37.89, 144.90, 20) // ~10km south
const recs = [...(await loadAllRecords()).values()]
recs.forEach(r => { if (r.registration==='VH-PVO'){ r.state='live_airborne'; r.confirmedMovement='airborne'; r.latitude=-37.80; r.longitude=144.90 } })
const fired = await evaluateProximityForUser(loc, recs)
ok(fired.length >= 1 && fired.every(e => e.eventType === 'proximity_enter'), `proximity_enter fired inside 30km (${fired.length})`)
ok(fired.some(e => e.registration === 'VH-PVO'), 'VH-PVO among fired')
const again = await evaluateProximityForUser(loc, recs)
ok(again.length === 0, 'proximity does not re-fire while inside (hysteresis)')
const evs = await listUserEvents(user!.id)
ok(evs.some(e => e.event_type === 'proximity_enter'), 'event persisted + listable for user')

await destroySession(token)
ok((await getSession(token)) === null, 'logout destroys session')
await getPool().end()
console.log('AUTH+ALERTS SMOKE PASS')
