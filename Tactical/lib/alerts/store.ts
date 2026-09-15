/** PG access for per-user location, alert settings, proximity state, deliveries. */
import { query } from '../db/pool.ts'
import { encryptField, decryptField } from '../auth/crypto.ts'
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

export interface AlertSettings { userId: number; pushEnabled: boolean; smsEnabled: boolean; smsConsent: boolean; callEnabled: boolean; callConsent: boolean; preciseLocation: boolean; enterMetres: number; exitMetres: number; pushToken: string | null }

export async function getAlertSettings(userId: number): Promise<AlertSettings> {
  const { rows } = await query<any>(
    `SELECT user_id, push_enabled, push_token, sms_enabled, sms_consent, call_enabled, call_consent, precise_location, enter_metres, exit_metres
       FROM user_alert_settings WHERE user_id=$1`, [userId])
  const cfg = proximityConfig()
  if (rows.length === 0) return { userId, pushEnabled: false, smsEnabled: false, smsConsent: false, callEnabled: false, callConsent: false, preciseLocation: false, enterMetres: cfg.enterMetres, exitMetres: cfg.exitMetres, pushToken: null }
  const r = rows[0]
  return { userId, pushEnabled: r.push_enabled, smsEnabled: r.sms_enabled, smsConsent: r.sms_consent,
    callEnabled: r.call_enabled === true, callConsent: r.call_consent === true,
    preciseLocation: r.precise_location === true,
    enterMetres: r.enter_metres, exitMetres: r.exit_metres, pushToken: r.push_token }
}

/**
 * Store a phone number for text/voice alerts. Encrypted at rest (AES-256-GCM
 * keyed from AUTH_SECRET) — the column is a *ref*, and only the delivery layer
 * ever decrypts it. Pass null to forget the number.
 */
export async function setAlertPhone(userId: number, kind: 'sms' | 'call', e164: string | null): Promise<void> {
  const ref = e164 ? encryptField(e164) : null
  if (kind === 'sms') {
    await query(
      `INSERT INTO user_alert_settings (user_id, sms_number_ref) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET sms_number_ref=EXCLUDED.sms_number_ref, updated_at=NOW()`, [userId, ref])
  } else {
    await query(
      `INSERT INTO user_alert_settings (user_id, call_number_ref) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET call_number_ref=EXCLUDED.call_number_ref, updated_at=NOW()`, [userId, ref])
  }
}

/** Decrypted numbers for the delivery layer ONLY. Never return these to a client. */
export async function getAlertPhones(userId: number): Promise<{ sms: string | null; call: string | null }> {
  const { rows } = await query<any>(
    `SELECT sms_number_ref, call_number_ref FROM user_alert_settings WHERE user_id=$1`, [userId])
  if (rows.length === 0) return { sms: null, call: null }
  return { sms: decryptField(rows[0].sms_number_ref), call: decryptField(rows[0].call_number_ref) }
}

/** True when a number is on file, for the settings UI — never the number itself. */
export async function hasAlertPhones(userId: number): Promise<{ sms: boolean; call: boolean }> {
  const { rows } = await query<any>(
    `SELECT sms_number_ref IS NOT NULL AS has_sms, call_number_ref IS NOT NULL AS has_call
       FROM user_alert_settings WHERE user_id=$1`, [userId])
  if (rows.length === 0) return { sms: false, call: false }
  return { sms: rows[0].has_sms === true, call: rows[0].has_call === true }
}

/**
 * Forget a browser subscription the push service reported as gone (browser data
 * cleared, permission revoked). Clears the token AND turns push off, so we stop
 * recording a failure for every single event; the UI then shows push as off and
 * the user can re-enable it with one tap, which re-subscribes.
 */
export async function clearPushToken(userId: number): Promise<void> {
  await query(
    `UPDATE user_alert_settings SET push_token=NULL, push_enabled=FALSE, updated_at=NOW() WHERE user_id=$1`,
    [userId],
  )
}

/**
 * Store (or clear) the browser's push subscription. Storing one turns push on;
 * clearing it (null) turns push off. Kept separate from updateAlertSettings
 * because the token column cannot be cleared through that function's COALESCE
 * patch semantics — "clear" and "leave alone" would look identical.
 */
export async function setPushSubscription(userId: number, sub: unknown | null): Promise<void> {
  const json = sub ? JSON.stringify(sub) : null
  await query(
    `INSERT INTO user_alert_settings (user_id, push_token, push_enabled)
     VALUES ($1, $2::text, ($2::text IS NOT NULL))
     ON CONFLICT (user_id) DO UPDATE SET
       push_token = EXCLUDED.push_token,
       push_enabled = ($2::text IS NOT NULL),
       updated_at = NOW()`,
    [userId, json],
  )
}

export async function updateAlertSettings(userId: number, patch: Partial<Pick<AlertSettings,'pushEnabled'|'smsEnabled'|'smsConsent'|'callEnabled'|'callConsent'|'pushToken'|'preciseLocation'|'enterMetres'|'exitMetres'>>): Promise<void> {
  await query(
    `INSERT INTO user_alert_settings (user_id, push_enabled, sms_enabled, sms_consent, call_enabled, call_consent, push_token, precise_location, enter_metres, exit_metres)
     VALUES ($1, COALESCE($2,FALSE), COALESCE($3,FALSE), COALESCE($4,FALSE), COALESCE($5,FALSE), COALESCE($6,FALSE), $7, COALESCE($8,FALSE), COALESCE($9,30000), COALESCE($10,33000))
     ON CONFLICT (user_id) DO UPDATE SET
       push_enabled=COALESCE($2, user_alert_settings.push_enabled),
       sms_enabled=COALESCE($3, user_alert_settings.sms_enabled),
       sms_consent=COALESCE($4, user_alert_settings.sms_consent),
       call_enabled=COALESCE($5, user_alert_settings.call_enabled),
       call_consent=COALESCE($6, user_alert_settings.call_consent),
       push_token=COALESCE($7, user_alert_settings.push_token),
       precise_location=COALESCE($8, user_alert_settings.precise_location),
       enter_metres=COALESCE($9, user_alert_settings.enter_metres),
       exit_metres=COALESCE($10, user_alert_settings.exit_metres),
       updated_at=NOW()`,
    [userId, patch.pushEnabled ?? null, patch.smsEnabled ?? null, patch.smsConsent ?? null,
     patch.callEnabled ?? null, patch.callConsent ?? null, patch.pushToken ?? null,
     patch.preciseLocation ?? null, patch.enterMetres ?? null, patch.exitMetres ?? null],
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

export async function recordDelivery(userId: number, eventDedupKey: string, channel: 'push'|'sms'|'call'|'inapp', status: 'recorded'|'sent'|'failed'|'disabled'): Promise<boolean> {
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
