/** PG access for per-user location, alert settings, proximity state, deliveries. */
import { query } from '../db/pool.ts'
import { locationExpirySeconds, proximityConfig } from '../adsb/config.ts'
import type { ProximityConfigMetres } from '../adsb/types.ts'

export interface UserLocation { userId: number; lat: number; lng: number; accuracyM: number | null; updatedAt: number; expiresAt: number }

export async function setUserLocation(userId: number, lat: number, lng: number, accuracyM: number | null): Promise<UserLocation> {
  const expiresAt = new Date(Date.now() + locationExpirySeconds() * 1000)
  await query(
    `INSERT INTO user_location_state (user_id, latitude, longitude, accuracy_m, updated_at, expires_at)
     VALUES ($1,$2,$3,$4,NOW(),$5)
     ON CONFLICT (user_id) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
       accuracy_m=EXCLUDED.accuracy_m, updated_at=NOW(), expires_at=EXCLUDED.expires_at`,
    [userId, lat, lng, accuracyM, expiresAt.toISOString()],
  )
  return { userId, lat, lng, accuracyM, updatedAt: Date.now(), expiresAt: expiresAt.getTime() }
}

export async function getUserLocation(userId: number): Promise<UserLocation | null> {
  const { rows } = await query<any>(
    `SELECT user_id, latitude, longitude, accuracy_m, updated_at, expires_at
       FROM user_location_state WHERE user_id=$1 AND expires_at > NOW()`, [userId])
  if (rows.length === 0) return null
  const r = rows[0]
  return { userId: Number(r.user_id), lat: r.latitude, lng: r.longitude, accuracyM: r.accuracy_m,
    updatedAt: new Date(r.updated_at).getTime(), expiresAt: new Date(r.expires_at).getTime() }
}

export async function getActiveUserLocations(): Promise<UserLocation[]> {
  const { rows } = await query<any>(
    `SELECT user_id, latitude, longitude, accuracy_m, updated_at, expires_at
       FROM user_location_state WHERE expires_at > NOW()`)
  return rows.map((r) => ({ userId: Number(r.user_id), lat: r.latitude, lng: r.longitude, accuracyM: r.accuracy_m,
    updatedAt: new Date(r.updated_at).getTime(), expiresAt: new Date(r.expires_at).getTime() }))
}

export interface AlertSettings { userId: number; pushEnabled: boolean; smsEnabled: boolean; smsConsent: boolean; enterMetres: number; exitMetres: number; pushToken: string | null }

export async function getAlertSettings(userId: number): Promise<AlertSettings> {
  const { rows } = await query<any>(
    `SELECT user_id, push_enabled, push_token, sms_enabled, sms_consent, enter_metres, exit_metres
       FROM user_alert_settings WHERE user_id=$1`, [userId])
  const cfg = proximityConfig()
  if (rows.length === 0) return { userId, pushEnabled: false, smsEnabled: false, smsConsent: false, enterMetres: cfg.enterMetres, exitMetres: cfg.exitMetres, pushToken: null }
  const r = rows[0]
  return { userId, pushEnabled: r.push_enabled, smsEnabled: r.sms_enabled, smsConsent: r.sms_consent,
    enterMetres: r.enter_metres, exitMetres: r.exit_metres, pushToken: r.push_token }
}

export async function updateAlertSettings(userId: number, patch: Partial<Pick<AlertSettings,'pushEnabled'|'smsEnabled'|'smsConsent'|'pushToken'|'enterMetres'|'exitMetres'>>): Promise<void> {
  await query(
    `INSERT INTO user_alert_settings (user_id, push_enabled, sms_enabled, sms_consent, push_token, enter_metres, exit_metres)
     VALUES ($1, COALESCE($2,FALSE), COALESCE($3,FALSE), COALESCE($4,FALSE), $5, COALESCE($6,30000), COALESCE($7,33000))
     ON CONFLICT (user_id) DO UPDATE SET
       push_enabled=COALESCE($2, user_alert_settings.push_enabled),
       sms_enabled=COALESCE($3, user_alert_settings.sms_enabled),
       sms_consent=COALESCE($4, user_alert_settings.sms_consent),
       push_token=COALESCE($5, user_alert_settings.push_token),
       enter_metres=COALESCE($6, user_alert_settings.enter_metres),
       exit_metres=COALESCE($7, user_alert_settings.exit_metres),
       updated_at=NOW()`,
    [userId, patch.pushEnabled ?? null, patch.smsEnabled ?? null, patch.smsConsent ?? null, patch.pushToken ?? null,
     patch.enterMetres ?? null, patch.exitMetres ?? null],
  )
}

export interface ProximityRow { armed: boolean; inside: boolean; seq: number }

export async function getProximityState(userId: number, registration: string): Promise<ProximityRow> {
  const { rows } = await query<any>(
    `SELECT armed, inside, seq FROM proximity_state WHERE user_id=$1 AND registration=$2`, [userId, registration])
  if (rows.length === 0) return { armed: true, inside: false, seq: 0 }
  return { armed: rows[0].armed, inside: rows[0].inside, seq: Number(rows[0].seq) }
}

export async function setProximityState(userId: number, registration: string, s: ProximityRow): Promise<void> {
  await query(
    `INSERT INTO proximity_state (user_id, registration, armed, inside, seq, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (user_id, registration) DO UPDATE SET armed=EXCLUDED.armed, inside=EXCLUDED.inside, seq=EXCLUDED.seq, updated_at=NOW()`,
    [userId, registration, s.armed, s.inside, s.seq],
  )
}

export async function recordDelivery(userId: number, eventDedupKey: string, channel: 'push'|'sms'|'inapp', status: 'recorded'|'sent'|'failed'|'disabled'): Promise<boolean> {
  const dedup = `${userId}:${eventDedupKey}:${channel}`
  const { rowCount } = await query(
    `INSERT INTO notification_deliveries (dedup_key, user_id, event_dedup_key, channel, status, delivered_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $5='sent' THEN NOW() ELSE NULL END)
     ON CONFLICT (dedup_key) DO NOTHING`,
    [dedup, userId, eventDedupKey, channel, status])
  return rowCount > 0
}

export async function listUserEvents(userId: number, limit = 50): Promise<any[]> {
  const { rows } = await query<any>(
    `SELECT event_type, registration, icao24, occurred_at, current_state, message
       FROM aircraft_events
      WHERE user_id=$1 OR user_id IS NULL
      ORDER BY occurred_at DESC LIMIT $2`, [userId, limit])
  return rows
}

export async function listUserDeliveries(userId: number, limit = 50): Promise<any[]> {
  const { rows } = await query<any>(
    `SELECT event_dedup_key, channel, status, created_at, delivered_at
       FROM notification_deliveries WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, limit])
  return rows
}

export function defaultProximityConfig(s: AlertSettings): ProximityConfigMetres {
  return { enterMetres: s.enterMetres, exitMetres: s.exitMetres }
}
