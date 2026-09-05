/**
 * Proximity + notification engine. Wires the tested haversine hysteresis
 * (lib/geo/haversine) to per-user/per-aircraft DB state and idempotent events.
 * Delivery is flagged off by env: deliveries are RECORDED, never actually sent,
 * until real push/SMS credentials are configured.
 */
import { stepProximity, initialProximityState } from '../geo/haversine.ts'
import { insertEventIfNew } from '../adsb/persistence/dashboard-persistence.ts'
import { typeLabelFor } from '../adsb/config.ts'
import type { AircraftRecord, AircraftEvent } from '../adsb/types.ts'
import {
  getProximityState, setProximityState, getAlertSettings, recordDelivery,
  defaultProximityConfig, type UserLocation,
} from './store.ts'
import { withProximityLock } from '../db/lease.ts'

const pushEnabled = () => process.env.PUSH_NOTIFICATIONS_ENABLED === 'true'
const smsEnabled = () => process.env.SMS_NOTIFICATIONS_ENABLED === 'true'

function isLiveWithPosition(r: AircraftRecord): boolean {
  return (r.state === 'live_airborne' || r.state === 'live_ground') &&
    r.latitude !== null && r.longitude !== null
}

/**
 * Evaluate proximity for one user against the current aircraft set. Returns the
 * proximity_enter events that fired this cycle (already persisted + recorded).
 */
export async function evaluateProximityForUser(
  loc: UserLocation,
  records: AircraftRecord[],
): Promise<AircraftEvent[]> {
  // Serialize per-user evaluation (worker cycle vs location POST) so the
  // read-modify-write of proximity_state cannot interleave and drop an event.
  return withProximityLock(loc.userId, () => evaluateLocked(loc, records))
}

async function evaluateLocked(loc: UserLocation, records: AircraftRecord[]): Promise<AircraftEvent[]> {
  const settings = await getAlertSettings(loc.userId)
  const cfg = defaultProximityConfig(settings)
  const fired: AircraftEvent[] = []

  for (const r of records) {
    if (!isLiveWithPosition(r)) continue
    const prev = await getProximityState(loc.userId, r.registration)
    const decision = stepProximity(
      { armed: prev.armed, inside: prev.inside },
      { lat: r.latitude as number, lng: r.longitude as number },
      { lat: loc.lat, lng: loc.lng },
      cfg,
    )

    let seq = prev.seq
    if (decision.fired) {
      seq = prev.seq + 1
      const icao = r.icao24 ?? r.registration
      const label = typeLabelFor(r.registration)
      const ev: AircraftEvent = {
        eventType: 'proximity_enter',
        registration: r.registration,
        icao24: r.icao24 ?? '',
        occurredAt: Date.now(),
        previousState: r.state,
        currentState: r.state,
        dedupKey: `${loc.userId}:${icao}:proximity:${seq}`,
        message: `${r.registration} (${label}) is now within range of your location.`,
      }
      const isNew = await insertEventIfNew(ev, loc.userId)
      if (isNew) {
        // In-app is always available (recorded). Push/SMS recorded but not sent
        // while delivery is flagged off — never faked as delivered.
        await recordDelivery(loc.userId, ev.dedupKey, 'inapp', 'recorded')
        if (settings.pushEnabled && settings.pushToken) {
          await recordDelivery(loc.userId, ev.dedupKey, 'push', pushEnabled() ? 'recorded' : 'disabled')
        }
        if (settings.smsEnabled && settings.smsConsent) {
          await recordDelivery(loc.userId, ev.dedupKey, 'sms', smsEnabled() ? 'recorded' : 'disabled')
        }
        fired.push(ev)
      }
    }
    await setProximityState(loc.userId, r.registration, { armed: decision.state.armed, inside: decision.state.inside, seq })
  }
  return fired
}
