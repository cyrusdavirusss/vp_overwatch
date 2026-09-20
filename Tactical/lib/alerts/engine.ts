/**
 * Proximity + notification engine. Wires the tested haversine hysteresis
 * (lib/geo/haversine) to per-user/per-aircraft DB state and idempotent events.
 *
 * Delivery is per-user opt-in and per-channel: browser push, email, text message,
 * and automated call may be enabled in any combination. Intrusive channels (text,
 * voice) additionally pass the quiet-hours policy; a suppression is written to the
 * ledger as 'held' so "why didn't I get a call?" has an answer. Each attempt records the
 * provider's ACTUAL outcome ('sent'/'failed') or 'disabled' when that channel
 * has no credentials on the server — never an assumed success.
 */
import { stepProximity, initialProximityState } from '../geo/haversine.ts'
import { insertEventIfNew } from '../adsb/persistence/dashboard-persistence.ts'
import { announceLabelFor } from '../adsb/config.ts'
import type { AircraftRecord, AircraftEvent } from '../adsb/types.ts'
import {
  getProximityState, setProximityState, getAlertSettings, recordDelivery,
  getAlertPhones, getAlertEmail, clearPushToken, defaultProximityConfig,
  type UserLocation, type AlertSettings,
} from './store.ts'
import {
  sendPush, sendEmail, sendSms, sendCall, parsePushSubscription,
  type DeliveryChannel, type DeliveryStatus,
} from './channels.ts'
import { mayDispatchNow, type QuietHours } from './policy.ts'
import { unsubscribeUrl } from './tokens.ts'
import { withProximityLock } from '../db/lease.ts'

function isLiveWithPosition(r: AircraftRecord): boolean {
  return (r.state === 'live_airborne' || r.state === 'live_ground') &&
    r.latitude !== null && r.longitude !== null
}

/**
 * Attempt every channel this user has opted into and return what actually
 * happened. A user may enable any combination; a channel they did not enable is
 * not recorded at all (absence of a row = not asked for).
 */
async function deliverEvent(
  settings: AlertSettings,
  ev: AircraftEvent,
): Promise<{ channel: DeliveryChannel; status: DeliveryStatus }[]> {
  const attempts: { channel: DeliveryChannel; status: DeliveryStatus }[] = []
  const body = ev.message

  try {
    if (settings.pushEnabled) {
      const r = await sendPush(parsePushSubscription(settings.pushToken), 'VP·Overwatch alert', body,
        { registration: ev.registration, eventType: ev.eventType })
      attempts.push({ channel: 'push', status: r.status })
      // The push service said this subscription is gone (browser data cleared,
      // permission revoked). Forget it so we stop recording a failure per event
      // and the UI can ask the user to re-enable.
      if (r.gone) await clearPushToken(settings.userId)
    }

    if (settings.emailEnabled && settings.emailConsent) {
      // Email is not intrusive, so quiet hours do not apply to it. It does require
      // a usable unsubscribe link, which sendEmail/computeConfig enforce upstream.
      const address = await getAlertEmail(settings.userId)
      const r = await sendEmail(address, 'VP·Overwatch alert', body, {
        unsubscribeUrl: unsubscribeUrl(settings.userId) ?? undefined,
      })
      attempts.push({ channel: 'email', status: r.status })
    }

    const quiet: QuietHours = {
      startHour: settings.quietHoursStart,
      endHour: settings.quietHoursEnd,
      timezone: settings.quietHoursTz,
      urgentBypass: settings.urgentBypass,
    }
    // A proximity entry IS the urgent case: an aircraft is inside the radius this
    // person chose. That is the alert worth waking someone for, so it may cross
    // quiet hours when they have left the bypass on.
    const urgent = ev.eventType === 'proximity_enter'

    const wantsSms = settings.smsEnabled && settings.smsConsent
    const wantsCall = settings.callEnabled && settings.callConsent
    if (wantsSms || wantsCall) {
      // Decrypted numbers are read only for users who asked for these channels,
      // and never leave this layer.
      const phones = await getAlertPhones(settings.userId)

      if (wantsSms) {
        const held = mayDispatchNow('sms', { quiet, urgent })
        attempts.push({ channel: 'sms', status: held.allowed ? await sendSms(phones.sms, body) : 'held' })
      }
      if (wantsCall) {
        const held = mayDispatchNow('call', { quiet, urgent })
        attempts.push({ channel: 'call', status: held.allowed ? await sendCall(phones.call, body) : 'held' })
      }
    }
  } catch (err: any) {
    // A transport failure must never break proximity evaluation itself.
    console.error('[alerts] delivery attempt failed:', err?.message || err)
  }

  return attempts
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
      const ev: AircraftEvent = {
        eventType: 'proximity_enter',
        registration: r.registration,
        icao24: r.icao24 ?? '',
        occurredAt: Date.now(),
        previousState: r.state,
        currentState: r.state,
        dedupKey: `${loc.userId}:${icao}:proximity:${seq}`,
        message: `${announceLabelFor(r.registration)} is now within range of your location.`,
      }
      const isNew = await insertEventIfNew(ev, loc.userId)
      if (isNew) {
        // In-app always lands: it is a row the user reads in the dashboard.
        await recordDelivery(loc.userId, ev.dedupKey, 'inapp', 'recorded')
        // Every other channel is attempted for real, then recorded with the
        // provider's actual outcome.
        for (const attempt of await deliverEvent(settings, ev)) {
          await recordDelivery(loc.userId, ev.dedupKey, attempt.channel, attempt.status)
        }
        fired.push(ev)
      }
    }
    await setProximityState(loc.userId, r.registration, { armed: decision.state.armed, inside: decision.state.inside, seq })
  }
  return fired
}
