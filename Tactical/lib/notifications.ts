/**
 * VP-Overwatch Notification Service
 *
 * Handles subscriber management and phone call dispatch when police aircraft
 * change state (takeoff, stealth, land). Uses Twilio Programmable Voice for
 * actual phone calls with text-to-speech recordings.
 *
 * Falls back to console + store logging when Twilio is not configured.
 * All notification events are recorded for audit regardless of delivery method.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface Subscriber {
  id: string
  name: string
  phone: string            // E.164 format, e.g. "+61412345678"
  enabled: boolean
  notifyOn: {
    takeoff: boolean       // Called when sortie starts
    stealth: boolean       // Called when aircraft goes dark mid-flight
    land: boolean          // Called when sortie ends
  }
  createdAt: number
  lastNotified: number | null
}

export interface NotificationEvent {
  id: string
  hex: string
  callsign: string
  eventType: 'takeoff' | 'stealth' | 'land'
  message: string
  calledSubscribers: string[]  // IDs of subscribers called
  timestamp: number
  delivered: boolean
  error?: string
}

// ── Message Templates ─────────────────────────────────────────────────────

function buildTakeoffMessage(hex: string, callsign: string, alt: number): string {
  return `Attention. Police aircraft ${callsign || hex} has taken off. Altitude ${alt} feet. Monitoring active.`
}

function buildStealthMessage(hex: string, callsign: string): string {
  return `Attention. Police aircraft ${callsign || hex} has gone stealth. Last position no longer broadcasting. Remain vigilant.`
}

function buildLandMessage(hex: string, callsign: string, durationMin: number): string {
  const mins = Math.round(durationMin)
  return `Attention. Police aircraft ${callsign || hex} has landed after ${mins} minutes airborne. All clear.`
}

// ── Twilio Integration ────────────────────────────────────────────────────

// Lazy-load Twilio client only if env vars are set
function getTwilioClient(): any | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  try {
    // Dynamic require to avoid crash when twilio isn't installed
    const twilio = require('twilio')
    return twilio(sid, token)
  } catch {
    console.warn('[notifications] twilio package not installed')
    return null
  }
}

const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || ''

/**
 * Place a phone call via Twilio with a TTS message.
 * Returns true if the call was initiated successfully.
 */
async function placeCall(phone: string, message: string): Promise<boolean> {
  const client = getTwilioClient()
  if (!client || !TWILIO_FROM) {
    console.log(`[notifications] WOULD CALL ${phone}: "${message}"`)
    return false  // dry run
  }

  try {
    const twiml = `<Response><Say voice="alice" language="en-AU">${escapeXml(message)}</Say></Response>`
    await client.calls.create({
      twiml,
      to: phone,
      from: TWILIO_FROM,
    })
    return true
  } catch (err: any) {
    console.error(`[notifications] Twilio call failed to ${phone}:`, err.message)
    return false
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Cleanup stale messages ────────────────────────────────────────────────

const EVENT_RETENTION_MS = 7 * 24 * 3600 * 1000  // 7 days

// ── Notification Engine ───────────────────────────────────────────────────

export interface NotifState {
  subscribers: Subscriber[]
  eventLog: NotificationEvent[]
  lastNotifiedTakeoff: Map<string, number>   // hex → timestamp
  stealthWarnings: Set<string>                // hexes that have gone stealth
  notifiedLanded: Set<string>                // hexes notified as landed
}

export function createNotifState(): NotifState {
  return {
    subscribers: [],
    eventLog: [],
    lastNotifiedTakeoff: new Map(),
    stealthWarnings: new Set(),
    notifiedLanded: new Set(),
  }
}

/**
 * Notify relevant subscribers about a takeoff event.
 * Dedupes: only notifies each hex/takeoff once.
 */
export async function notifyTakeoff(
  state: NotifState,
  hex: string,
  callsign: string,
  alt: number
): Promise<void> {
  const lastNotif = state.lastNotifiedTakeoff.get(hex) ?? 0
  const now = Date.now()
  // Don't notify again for same hex within 10 minutes
  if (now - lastNotif < 10 * 60 * 1000) return

  const message = buildTakeoffMessage(hex, callsign, alt)
  const matchingSubscribers = state.subscribers.filter(s => s.enabled && s.notifyOn.takeoff)

  const event: NotificationEvent = {
    id: `notif-takeoff-${hex}-${now}`,
    hex, callsign, eventType: 'takeoff', message,
    calledSubscribers: [],
    timestamp: now,
    delivered: false,
  }

  for (const sub of matchingSubscribers) {
    const ok = await placeCall(sub.phone, message)
    event.calledSubscribers.push(sub.id)
    if (!ok) event.error = 'call_failed'
    sub.lastNotified = now
  }

  event.delivered = event.calledSubscribers.length > 0 && !event.error
  state.eventLog.push(event)
  state.lastNotifiedTakeoff.set(hex, now)
  state.stealthWarnings.delete(hex)
  state.notifiedLanded.delete(hex)
  trimEventLog(state)
}

/**
 * Notify subscribers when an aircraft goes stealth (was active, vanished mid-flight).
 */
export async function notifyStealth(
  state: NotifState,
  hex: string,
  callsign: string
): Promise<void> {
  if (state.stealthWarnings.has(hex)) return  // already warned

  const message = buildStealthMessage(hex, callsign)
  const matchingSubscribers = state.subscribers.filter(s => s.enabled && s.notifyOn.stealth)
  const now = Date.now()

  const event: NotificationEvent = {
    id: `notif-stealth-${hex}-${now}`,
    hex, callsign, eventType: 'stealth', message,
    calledSubscribers: [],
    timestamp: now,
    delivered: false,
  }

  for (const sub of matchingSubscribers) {
    const ok = await placeCall(sub.phone, message)
    event.calledSubscribers.push(sub.id)
    if (!ok) event.error = 'call_failed'
    sub.lastNotified = now
  }

  event.delivered = event.calledSubscribers.length > 0 && !event.error
  state.eventLog.push(event)
  state.stealthWarnings.add(hex)
  trimEventLog(state)
}

/**
 * Notify subscribers when an aircraft lands.
 */
export async function notifyLand(
  state: NotifState,
  hex: string,
  callsign: string,
  durationSeconds: number
): Promise<void> {
  if (state.notifiedLanded.has(hex)) return

  const message = buildLandMessage(hex, callsign, durationSeconds / 60)
  const matchingSubscribers = state.subscribers.filter(s => s.enabled && s.notifyOn.land)
  const now = Date.now()

  const event: NotificationEvent = {
    id: `notif-land-${hex}-${now}`,
    hex, callsign, eventType: 'land', message,
    calledSubscribers: [],
    timestamp: now,
    delivered: false,
  }

  for (const sub of matchingSubscribers) {
    const ok = await placeCall(sub.phone, message)
    event.calledSubscribers.push(sub.id)
    if (!ok) event.error = 'call_failed'
    sub.lastNotified = now
  }

  event.delivered = event.calledSubscribers.length > 0 && !event.error
  state.eventLog.push(event)
  state.notifiedLanded.add(hex)
  trimEventLog(state)
}

function trimEventLog(state: NotifState): void {
  const cutoff = Date.now() - EVENT_RETENTION_MS
  const keep: NotificationEvent[] = []
  for (const e of state.eventLog) {
    if (e.timestamp >= cutoff) keep.push(e)
  }
  state.eventLog = keep
}

/**
 * Reset notification state for conditions that no longer apply.
 * Called when a hex goes inactive (landed) — resets stealth + land dedup
 * so next takeoff cycle works fresh.
 */
export function resetHexNotifications(state: NotifState, hex: string): void {
  state.lastNotifiedTakeoff.delete(hex)
  state.stealthWarnings.delete(hex)
  state.notifiedLanded.delete(hex)
}

// ── Subscriber CRUD ──────────────────────────────────────────────────────

export function addSubscriber(
  state: NotifState,
  name: string,
  phone: string,
  notifyOn: Subscriber['notifyOn'] = { takeoff: true, stealth: true, land: true }
): Subscriber {
  const sub: Subscriber = {
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    phone,
    enabled: true,
    notifyOn,
    createdAt: Date.now(),
    lastNotified: null,
  }
  state.subscribers.push(sub)
  return sub
}

export function removeSubscriber(state: NotifState, id: string): boolean {
  const idx = state.subscribers.findIndex(s => s.id === id)
  if (idx === -1) return false
  state.subscribers.splice(idx, 1)
  return true
}

export function updateSubscriber(
  state: NotifState,
  id: string,
  updates: Partial<Subscriber>
): Subscriber | null {
  const sub = state.subscribers.find(s => s.id === id)
  if (!sub) return null
  Object.assign(sub, updates)
  return sub
}
