/**
 * POST /api/sighting
 * Receives a visual sighting ray from an AR goggle user.
 * Stores it, re-triangulates, and broadcasts the updated community dot.
 *
 * GET /api/sighting?hex=XXXXXX
 * Returns the current community dot for a given aircraft hex.
 *
 * GET /api/sighting/all
 * Returns all active community dots.
 */

import { NextRequest, NextResponse } from 'next/server'
import { computeCommunityDot, DOT_TTL_MS, type VisualSightingRay, type CommunityDot } from '@/lib/visual-sighting'
import { rateLimit, rateLimitIp, clientIp } from '@/lib/auth/rate-limit'
import { randomUUID } from 'crypto'

// ── In-memory store (replace with Postgres for persistence) ───────────────
// Key: aircraftHex, Value: array of recent sighting rays
const sightingRays = new Map<string, VisualSightingRay[]>()
// Key: aircraftHex, Value: computed community dot
const communityDots = new Map<string, CommunityDot>()

// Bounds on public, unauthenticated state. The key is caller-chosen and the value
// is an array the caller appends to, so both need a ceiling or one client can grow
// this process's heap with junk — and every request re-triangulates the array with
// a nested pair loop, so the work grows quadratically with the ray count.
const MAX_RAYS_PER_KEY = 12
const MAX_TRACKED_KEYS = 200

// Prune stale rays every 2 minutes
setInterval(() => {
  const now = Date.now()
  for (const [hex, rays] of sightingRays.entries()) {
    const fresh = rays.filter(r => now - r.timestamp < 90_000)
    if (fresh.length === 0) {
      sightingRays.delete(hex)
      communityDots.delete(hex)
    } else {
      sightingRays.set(hex, fresh)
    }
  }
  // Expire old dots
  for (const [hex, dot] of communityDots.entries()) {
    if (now - dot.lastSeenAt > DOT_TTL_MS) {
      communityDots.delete(hex)
    }
  }
}, 120_000)

// ── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Anonymous write endpoint: a goggle user submits rays repeatedly while
    // looking at a target, so allow a burst, but bound it per IP and globally.
    const ipRl = rateLimitIp(clientIp(req.headers), 'sighting', 60, 3600)
    const globalRl = rateLimit('sighting:global', 600, 3600)
    if (!ipRl.allowed || !globalRl.allowed) {
      return NextResponse.json({ error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(Math.max(ipRl.retryAfterSec, globalRl.retryAfterSec)) } })
    }
    const body = await req.json()

    // Validate required fields
    const { aircraftHex, observerLat, observerLng, bearingDeg, elevationDeg, sessionId } = body

    if (
      typeof aircraftHex !== 'string' ||
      typeof observerLat !== 'number' ||
      typeof observerLng !== 'number' ||
      typeof bearingDeg !== 'number' ||
      typeof elevationDeg !== 'number'
    ) {
      return NextResponse.json({ error: 'Invalid sighting data' }, { status: 400 })
    }

    // `typeof NaN === 'number'`, and every range test below is FALSE for NaN — so
    // without this, NaN sailed through the bounds and produced a dot at NaN, which
    // then went to a MapLibre marker. Reject non-finite first.
    if (
      !Number.isFinite(observerLat) || !Number.isFinite(observerLng) ||
      !Number.isFinite(bearingDeg) || !Number.isFinite(elevationDeg)
    ) {
      return NextResponse.json({ error: 'Non-finite sighting data' }, { status: 400 })
    }

    // The identifier is a 24-bit ICAO hex, and it becomes a Map KEY and a map
    // LABEL. Anything else is either a typo or an injection attempt; it is refused
    // here rather than sanitised, so no free text from this route ever reaches the
    // client. (The marker now uses textContent as well — belt and braces.)
    const hex = aircraftHex.trim().toUpperCase()
    if (!/^[0-9A-F]{6}$/.test(hex)) {
      return NextResponse.json({ error: 'aircraftHex must be a 6-digit ICAO hex' }, { status: 400 })
    }

    // Sanity bounds
    if (
      observerLat < -90 || observerLat > 90 ||
      observerLng < -180 || observerLng > 180 ||
      bearingDeg < 0 || bearingDeg > 360 ||
      elevationDeg < -10 || elevationDeg > 90
    ) {
      return NextResponse.json({ error: 'Out of range values' }, { status: 400 })
    }

    const ray: VisualSightingRay = {
      id: randomUUID(),
      aircraftHex: hex,
      observerLat,
      observerLng,
      bearingDeg,
      elevationDeg,
      timestamp: Date.now(),
      sessionId: sessionId || randomUUID(),
    }

    // Store the ray, BOUNDED. The key is attacker-chosen and the value is an
    // unbounded array, so without caps one client could grow this process's heap
    // with junk keys, and every request re-triangulates the whole array (nested
    // pair loop). Keep the newest rays per key and the most recent keys overall.
    const existing = sightingRays.get(ray.aircraftHex) ?? []
    existing.push(ray)
    if (existing.length > MAX_RAYS_PER_KEY) existing.splice(0, existing.length - MAX_RAYS_PER_KEY)
    sightingRays.set(ray.aircraftHex, existing)

    if (sightingRays.size > MAX_TRACKED_KEYS) {
      // Map preserves insertion order: drop the oldest keys first.
      for (const key of sightingRays.keys()) {
        if (sightingRays.size <= MAX_TRACKED_KEYS) break
        sightingRays.delete(key)
        communityDots.delete(key)
      }
    }

    // Re-triangulate
    const prev = communityDots.get(ray.aircraftHex) ?? null
    const dot = computeCommunityDot(ray.aircraftHex, existing, prev)

    if (dot) {
      communityDots.set(ray.aircraftHex, dot)
    }

    return NextResponse.json({
      success: true,
      rayId: ray.id,
      dot: dot ?? null,
      sightingCount: existing.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// ── GET handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const hex = searchParams.get('hex')

  if (hex) {
    const dot = communityDots.get(hex.toUpperCase())
    return NextResponse.json({ dot: dot ?? null })
  }

  // Return all active dots
  const now = Date.now()
  const all = Array.from(communityDots.values()).filter(
    d => now - d.lastSeenAt < DOT_TTL_MS
  )
  return NextResponse.json({ dots: all })
}
