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

import {
  AIRCRAFT as MOCK_AIRCRAFT,
  REPORTS as MOCK_REPORTS,
  USER as MOCK_USER,
  RELAY as MOCK_RELAY,
} from '@/lib/data'

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
    aircraft: MOCK_AIRCRAFT,
    reports: MOCK_REPORTS,
    user: MOCK_USER,
    relay: MOCK_RELAY,
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

  // ── Reports poll — keep mock data if API returns empty ────────────────
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
      const result = await fetchJson<Relay>('/api/relay/status', MOCK_RELAY)
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
