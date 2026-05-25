'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  Aircraft,
  Report,
  User,
  Relay,
  TrackPoint,
  Aircraft as AircraftType,
} from '@/lib/data'

// Re-export helper functions from data for convenience
export {
  sampleTrack,
  sampleTrailUntil,
  computeDistance,
} from '@/lib/data'

// ── Types ────────────────────────────────────────────────────────────────

export interface RealtimeData {
  aircraft: Aircraft[]
  reports: Report[]
  user: User
  relay: Relay
  loading: boolean
  error: string | null
  lastUpdate: number
}

// ── Fallback: use mock data while API is starting up ──────────────────────

import {
  AIRCRAFT as MOCK_AIRCRAFT,
  REPORTS as MOCK_REPORTS,
  USER as MOCK_USER,
  RELAY as MOCK_RELAY,
} from '@/lib/data'

// ── Hook ──────────────────────────────────────────────────────────────────

interface UseRealtimeOptions {
  /** Poll interval for aircraft in ms (default: 30000) */
  aircraftInterval?: number
  /** Poll interval for reports in ms (default: 15000) */
  reportsInterval?: number
  /** Poll interval for GPS in ms (default: 10000) */
  gpsInterval?: number
  /** Poll interval for relay status in ms (default: 3000) */
  relayInterval?: number
  /** Whether to start polling immediately (default: true) */
  enabled?: boolean
}

export function useRealtimeData(options: UseRealtimeOptions = {}): RealtimeData {
  const {
    aircraftInterval = 30_000,
    reportsInterval = 15_000,
    gpsInterval = 10_000,
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

  // ── Fetch helper ──────────────────────────────────────────────────────

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

  // ── Aircraft poll ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return

    let mounted = true

    async function poll() {
      const result = await fetchJson<Aircraft[]>('/api/aircraft/active', MOCK_AIRCRAFT)
      if (!mounted) return
      setData((prev) => ({
        ...prev,
        aircraft: result,
        loading: false,
        lastUpdate: Date.now(),
      }))
      hasEverLoaded.current = true
    }

    poll()
    const id = setInterval(poll, aircraftInterval)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [enabled, aircraftInterval, fetchJson])

  // ── Reports poll ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return

    let mounted = true

    async function poll() {
      const result = await fetchJson<Report[]>('/api/waze/alerts', MOCK_REPORTS)
      if (!mounted) return
      setData((prev) => ({
        ...prev,
        reports: result,
        lastUpdate: Date.now(),
      }))
    }

    poll()
    const id = setInterval(poll, reportsInterval)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [enabled, reportsInterval, fetchJson])

  // ── GPS poll ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return

    let mounted = true

    async function poll() {
      const result = await fetchJson<User>('/api/gps/location', MOCK_USER)
      if (!mounted) return
      setData((prev) => ({
        ...prev,
        user: result,
        lastUpdate: Date.now(),
      }))
    }

    poll()
    const id = setInterval(poll, gpsInterval)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [enabled, gpsInterval, fetchJson])

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
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [enabled, relayInterval, fetchJson])

  return data
}
