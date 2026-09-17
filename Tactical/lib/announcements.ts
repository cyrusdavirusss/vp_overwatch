/**
 * Operator announcements: a notice written by a human, shown in-app to every
 * visitor and pushed to the subscribers who have push enabled.
 *
 * Why this is not part of the alert engine: `aircraft_events` rows are derived from
 * telemetry and are per-user (a proximity hit for one person's location). An
 * announcement is authored, identical for every reader, and has no aircraft attached.
 * Deliveries DO share `notification_deliveries`, so "what did we actually send and
 * did it arrive" keeps a single answer.
 *
 * The honesty rules are the ones the alert layer already follows, because a delivery
 * ledger that lies is worse than no ledger:
 *   'sent'     only when the push service ACCEPTED the message
 *   'failed'   we tried and could not deliver — including the case where a subscriber
 *              has push on but no stored subscription, since they asked for it
 *   'disabled' push has no VAPID credentials on this server at all
 *
 * One deliberate omission: no per-user 'inapp' rows. The in-app surface for an
 * announcement is a public banner, not a per-user inbox item, so recording one
 * delivery row per subscriber would be inventing data.
 */
import { query } from './db/pool.ts'
import { sendPush, parsePushSubscription, pushConfigured } from './alerts/channels.ts'
import { clearPushToken } from './alerts/store.ts'

export type AnnouncementLevel = 'info' | 'notice' | 'warning' | 'critical'

export interface Announcement {
  id: number
  title: string
  body: string
  level: AnnouncementLevel
  pinned: boolean
  publishedAt: number
  expiresAt: number | null
  withdrawnAt: number | null
  createdBy: string
}

interface Row {
  id: string | number
  title: string
  body: string
  level: AnnouncementLevel
  pinned: boolean
  published_at: Date | string
  expires_at: Date | string | null
  withdrawn_at: Date | string | null
  created_by: string
}

const ms = (v: Date | string | null): number | null => (v === null ? null : new Date(v).getTime())

function toAnnouncement(r: Row): Announcement {
  return {
    id: Number(r.id),
    title: r.title,
    body: r.body,
    level: r.level,
    pinned: r.pinned === true,
    publishedAt: ms(r.published_at) as number,
    expiresAt: ms(r.expires_at),
    withdrawnAt: ms(r.withdrawn_at),
    createdBy: r.created_by,
  }
}

const COLS = `id, title, body, level, pinned, published_at, expires_at, withdrawn_at, created_by`

/** What a visitor sees: published, not withdrawn, not expired. */
export async function listLiveAnnouncements(limit = 5): Promise<Announcement[]> {
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM announcements
      WHERE withdrawn_at IS NULL
        AND published_at <= NOW()
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY pinned DESC, published_at DESC
      LIMIT $1`,
    [limit],
  )
  return rows.map(toAnnouncement)
}

/** For the authoring view: everything, including withdrawn and expired. */
export async function listAllAnnouncements(limit = 50): Promise<Announcement[]> {
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM announcements ORDER BY published_at DESC LIMIT $1`, [limit],
  )
  return rows.map(toAnnouncement)
}

export async function createAnnouncement(input: {
  title: string
  body: string
  level?: AnnouncementLevel
  pinned?: boolean
  expiresAt?: Date | null
  createdBy?: string
}): Promise<Announcement> {
  const { rows } = await query<Row>(
    `INSERT INTO announcements (title, body, level, pinned, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
    [
      input.title.trim(),
      input.body.trim(),
      input.level ?? 'info',
      input.pinned === true,
      input.expiresAt ?? null,
      input.createdBy ?? 'operator',
    ],
  )
  return toAnnouncement(rows[0])
}

/**
 * Soft delete. The row stays so the audit trail survives — "we told everyone X on
 * this date" is a fact about the system, not something to erase.
 */
export async function withdrawAnnouncement(id: number): Promise<Announcement | null> {
  const { rows } = await query<Row>(
    `UPDATE announcements SET withdrawn_at = NOW()
      WHERE id = $1 AND withdrawn_at IS NULL RETURNING ${COLS}`, [id],
  )
  return rows.length ? toAnnouncement(rows[0]) : null
}

export interface DeliveryTally { sent: number; failed: number; disabled: number }

function dedupKey(id: number, userId: number, channel: string) {
  return `ann:${id}:${userId}:${channel}`
}

/**
 * Push an announcement to every subscriber with push enabled, and record what
 * actually happened. Idempotent per (announcement, user, channel) via the ledger's
 * dedup_key, so re-running cannot double-notify anyone.
 *
 * A subscription the push service reports as gone clears that user's token and is
 * recorded once as failed, rather than failing on every future announcement.
 */
export async function deliverAnnouncement(a: Announcement): Promise<DeliveryTally & { recipients: number }> {
  const tally: DeliveryTally = { sent: 0, failed: 0, disabled: 0 }
  if (!pushConfigured()) {
    // Record nothing: with no provider configured there is no delivery to audit, and
    // the settings screen already tells the user the channel is unavailable.
    return { ...tally, recipients: 0 }
  }

  const { rows: subs } = await query<{ user_id: string; push_token: string | null }>(
    `SELECT user_id, push_token FROM user_alert_settings WHERE push_enabled = TRUE`,
  )

  for (const s of subs) {
    const userId = Number(s.user_id)
    const key = dedupKey(a.id, userId, 'push')

    // Already delivered? The ledger is the record of truth; skip.
    const { rows: seen } = await query<{ status: string }>(
      `SELECT status FROM notification_deliveries WHERE dedup_key = $1`, [key],
    )
    if (seen.length && seen[0].status === 'sent') { tally.sent++; continue }

    if (!s.push_token) {
      // Push is ON but there is nowhere to send. That is a failure to deliver
      // something they asked for, not a reason to stay silent.
      await record(key, userId, 'announcement', 'push', 'failed', a.id)
      tally.failed++
      continue
    }

    const parsed = parsePushSubscription(s.push_token)
    const res = await sendPush(parsed, a.title, a.body, { announcementId: a.id, level: a.level })
    if (res.status === 'sent') {
      await record(key, userId, 'announcement', 'push', 'sent', a.id)
      tally.sent++
    } else {
      if (res.gone) await clearPushToken(userId)
      await record(key, userId, 'announcement', 'push', 'failed', a.id)
      tally.failed++
    }
  }

  return { ...tally, recipients: subs.length }
}

async function record(
  dedupKey: string, userId: number, eventKey: string, channel: string, status: string, announcementId: number,
): Promise<void> {
  await query(
    `INSERT INTO notification_deliveries (dedup_key, user_id, event_dedup_key, channel, status, delivered_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = 'sent' THEN NOW() ELSE NULL END)
     ON CONFLICT (dedup_key) DO UPDATE SET status = EXCLUDED.status,
       delivered_at = CASE WHEN EXCLUDED.status = 'sent' THEN NOW() ELSE notification_deliveries.delivered_at END`,
    [dedupKey, userId, `${eventKey}:${announcementId}`, channel, status],
  )
}

/** Per-announcement delivery counts, for the operator to see rather than assume. */
export async function deliverySummary(announcementId: number): Promise<DeliveryTally> {
  const { rows } = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*) AS n FROM notification_deliveries
      WHERE event_dedup_key = $1 GROUP BY status`, [`announcement:${announcementId}`],
  )
  const out: DeliveryTally = { sent: 0, failed: 0, disabled: 0 }
  for (const r of rows) {
    const n = Number(r.n)
    if (r.status === 'sent') out.sent = n
    else if (r.status === 'failed') out.failed = n
    else if (r.status === 'disabled') out.disabled = n
  }
  return out
}
