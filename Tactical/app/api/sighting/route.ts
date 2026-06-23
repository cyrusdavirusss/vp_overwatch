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
import { randomUUID } from 'crypto'

// ── In-memory store (replace with Postgres for persistence) ───────────────
// Key: aircraftHex, Value: array of recent sighting rays
const sightingRays = new Map<string, VisualSightingRay[]>()
// Key: aircraftHex, Value: computed community dot
const communityDots = new Map<string, CommunityDot>()

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
      aircraftHex: aircraftHex.toUpperCase(),
      observerLat,
      observerLng,
      bearingDeg,
      elevationDeg,
      timestamp: Date.now(),
      sessionId: sessionId || randomUUID(),
    }

    // Store the ray
    const existing = sightingRays.get(ray.aircraftHex) ?? []
    existing.push(ray)
    sightingRays.set(ray.aircraftHex, existing)

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
