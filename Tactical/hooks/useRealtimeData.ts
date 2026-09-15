'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  Aircraft,
  Report,
  User,
  Relay,
} from '@/lib/data'

export {
  sampleTrack,
  sampleTrailUntil,
  computeDistance,
} from '@/lib/data'

export interface RealtimeData {
  aircraft: Aircraft[]
  reports: Report[]
  user: User
  relay: Relay
  loading: boolean
  error: string | null
  lastUpdate: number
}

interface UseRealtimeOptions {
  aircraftInterval?: number
  reportsInterval?: number
  relayInterval?: number
  enabled?: boolean
}

export function useRealtimeData(options: UseRealtimeOptions = {}): RealtimeData {
  const {
    aircraftInterval = 30_000,
    reportsInterval = 15_000,
    relayInterval = 3_000,
    enabled = true,
  } = options

  const [data, setData] = useState<RealtimeData>({
    aircraft: [],
    reports: [],
    user: { lat: -37.8136, lng: 144.9631, hdg: 0, accuracy: 5000 },
    relay: { connected: false, lastTickAgo: 0, pollIntervalSec: 60, lastIngested: 0, lastRaw: 0, coverageRegions: 0 },
    loading: true,
    error: null,
    lastUpdate: Date.now(),
  })

  const hasEverLoaded = useRef(false)

  const fetchJson = useCallback(async <T,>(url: string, fallback: T): Promise<T> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err: any) {
      console.warn(`[useRealtimeData] ${url}: ${err.message}`)
      return fallback
    }
  }, [])

  // ── User position is handled client-only by useClientLocation hook ────
  // No browser geolocation, no IP fallback, no network POST of coordinates.

  // ── Aircraft poll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    let mounted = true

    async function poll() {
      const result = await fetchJson<Aircraft[]>('/api/aircraft/active', [])
      if (!mounted) return
      setData((prev) => ({
        ...prev,
        aircraft: result.length > 0 ? result : prev.aircraft,
        loading: false,
        lastUpdate: Date.now(),
      }))
      hasEverLoaded.current = true
    }

    poll()
    const id = setInterval(poll, aircraftInterval)
    return () => { mounted = false; clearInterval(id) }
  }, [enabled, aircraftInterval, fetchJson])

  // ── Reports poll — stays empty until relay pushes real data ────────────
  useEffect(() => {
    if (!enabled) return
    let mounted = true

    async function poll() {
      const result = await fetchJson<Report[]>('/api/waze/alerts', [])
      if (!mounted) return
      setData((prev) => ({
        ...prev,
        reports: result.length > 0 ? result : prev.reports,
        lastUpdate: Date.now(),
      }))
    }

    poll()
    const id = setInterval(poll, reportsInterval)
    return () => { mounted = false; clearInterval(id) }
  }, [enabled, reportsInterval, fetchJson])

  // ── Relay status poll ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    let mounted = true

    async function poll() {
      const result = await fetchJson<Relay>('/api/relay/status', {
        connected: false, lastTickAgo: 0, pollIntervalSec: 60,
        lastIngested: 0, lastRaw: 0, coverageRegions: 0,
      })
      if (!mounted) return
      setData((prev) => ({
        ...prev,
        relay: result,
        lastUpdate: Date.now(),
      }))
    }

    poll()
    const id = setInterval(poll, relayInterval)
    return () => { mounted = false; clearInterval(id) }
  }, [enabled, relayInterval, fetchJson])

  return data
}
