'use client'

/**
 * Authenticated 3-second dashboard feed for the four tracked aircraft.
 * Polls VP Overwatch's OWN cached endpoint (never ADS-B Exchange) with the
 * session cookie. Between polls, live aircraft positions are dead-reckoned so
 * the displayed location stays current instead of sitting up to 3 s stale.
 * A 401 surfaces as `unauthenticated` so the page can show a sign-in prompt.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { deadReckon } from '@/lib/geo/dead-reckoning'

export interface DashboardAircraft {
  registration: string
  description: string
  icao24: string | null
  mappingStatus: string
  state: 'unresolved' | 'live_airborne' | 'live_ground' | 'stale' | 'unavailable'
  dataStatus: 'live' | 'stale' | 'unavailable'
  lastObservedAt: string | null
  positionAgeSeconds: number | null
  latitude: number | null
  longitude: number | null
  altitudeMetres: number | null
  groundSpeedKt: number | null
  trackDegrees: number | null
  verticalRateFpm: number | null
  onGround: boolean | null
  isPositionUsable: boolean
}

export interface DashboardSnapshot {
  aircraft: DashboardAircraft[]
  lastUpdate: string
  providerStatus: 'live' | 'stale' | 'unavailable'
  lastSuccessfulCycleAt: string | null
  count: number
}

export interface UseDashboardResult {
  snapshot: DashboardSnapshot | null
  loading: boolean
  unauthenticated: boolean
  error: string | null
  /** Dead-reckoned {lat,lng} for a live aircraft at the current instant. */
  interpolatedPosition: (a: DashboardAircraft) => { lat: number; lng: number } | null
  refresh: () => void
}

const POLL_MS = 3000

export function useDashboardAircraft(): UseDashboardResult {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const receivedAt = useRef<number>(Date.now())

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/aircraft', { cache: 'no-store', credentials: 'same-origin' })
      if (res.status === 401) { setUnauthenticated(true); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: DashboardSnapshot = await res.json()
      setSnapshot(data)
      setUnauthenticated(false)
      setError(null)
      receivedAt.current = Date.now()
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    poll()
    const id = setInterval(() => { if (alive) poll() }, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [poll])

  const interpolatedPosition = useCallback((a: DashboardAircraft) => {
    if (a.latitude === null || a.longitude === null) return null
    if (a.state !== 'live_airborne') return { lat: a.latitude, lng: a.longitude }
    // Elapsed since the position was actually observed (age at poll + wall time
    // since we received the poll) — dead-reckon forward from there.
    const sincePoll = (Date.now() - receivedAt.current) / 1000
    const elapsed = (a.positionAgeSeconds ?? 0) + sincePoll
    return deadReckon(
      { lat: a.latitude, lng: a.longitude, headingDeg: a.trackDegrees, groundSpeedKt: a.groundSpeedKt },
      elapsed,
    )
  }, [])

  return { snapshot, loading, unauthenticated, error, interpolatedPosition, refresh: poll }
}
