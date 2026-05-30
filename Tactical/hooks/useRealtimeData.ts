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
  gpsInterval?: number
  relayInterval?: number
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

  // ── Browser geolocation (requires HTTPS) ───────────────────────────────
  // If denied or unavailable, falls back to IP geolocation after 5 seconds.
  useEffect(() => {
    if (!enabled) return

    let watchId: number
    let ipFallbackTimer: ReturnType<typeof setTimeout>
    let gpsReceived = false

    function sendGPS(lat: number, lng: number, hdg: number, accuracy: number) {
      gpsReceived = true
      setData((prev) => ({
        ...prev,
        user: { lat, lng, hdg, accuracy },
      }))
      fetch('/api/gps/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gps-secret': 'gps-dev' },
        body: JSON.stringify({ lat, lng, hdg, accuracy }),
      }).catch(() => {})
    }

    // Fallback to IP geolocation if browser GPS doesn't fire in 5s
    ipFallbackTimer = setTimeout(async () => {
      if (gpsReceived) return
      console.log('[GPS] No browser GPS in 5s, trying IP geolocation fallback')
      await tryIpGeo(setData)
    }, 5_000)

    async function tryIpGeo(
      setter: React.Dispatch<React.SetStateAction<RealtimeData>>
    ) {
      // Try server-side geoip first (resolves from request IP)
      try {
        const res = await fetch('/api/gps/geoip')
        const data = await res.json()
        if (data.source !== 'fallback' && data.source !== 'gps') {
          setter((prev) => ({
            ...prev,
            user: { lat: data.lat, lng: data.lng, hdg: data.hdg ?? 0, accuracy: data.accuracy ?? 5000 },
          }))
          return
        }
      } catch {}

      // Fallback: client-side IP geo via ip-api.com directly (CORS-allowed)
      // This resolves the phone's actual external IP, not the server's
      try {
        const res = await fetch('http://ip-api.com/json/?fields=status,lat,lon,city')
        const data = await res.json()
        if (data.status === 'success') {
          setter((prev) => ({
            ...prev,
            user: {
              lat: data.lat,
              lng: data.lon,
              hdg: 0,
              accuracy: 5000,
            },
          }))
        }
      } catch (e) {
        console.warn('[GPS] Client-side IP geo failed:', e)
      }
    }

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          clearTimeout(ipFallbackTimer)
          sendGPS(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.heading ?? 0,
            pos.coords.accuracy,
          )
        },
        (err) => {
          console.warn('[GPS] geolocation error:', err.message)
            // Error fired immediately (e.g. permission denied) — trigger fallback faster
          if (err.code === err.PERMISSION_DENIED || err.code === err.TIMEOUT) {
            clearTimeout(ipFallbackTimer)
            ipFallbackTimer = setTimeout(async () => {
              if (gpsReceived) return
              await tryIpGeo(setData)
            }, 1_000)
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      )
    } else {
      // No geolocation API at all — fall back immediately
      clearTimeout(ipFallbackTimer)
      tryIpGeo(setData)
    }

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      clearTimeout(ipFallbackTimer)
    }
  }, [enabled])

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

  // ── GPS poll (server-side position, supplements browser geolocation) ──
  useEffect(() => {
    if (!enabled) return
    let mounted = true

    async function poll() {
      const result = await fetchJson<User>('/api/gps/location', MOCK_USER)
      if (!mounted) return
      setData((prev) => {
        // Don't prefer the mock default (Melbourne CBD) over a real result
        const isPrevDefault =
          Math.abs(prev.user.lat - (-37.8136)) < 0.001 &&
          Math.abs(prev.user.lng - 144.9631) < 0.001
        const isResultDefault =
          Math.abs(result.lat - (-37.8136)) < 0.001 &&
          Math.abs(result.lng - 144.9631) < 0.001
        // Prefer better accuracy, unless current is the mock default and result isn't
        if (!isPrevDefault && !isResultDefault && prev.user.accuracy < result.accuracy) return prev
        if (isPrevDefault && !isResultDefault) return { ...prev, user: result, lastUpdate: Date.now() }
        return { ...prev, user: result, lastUpdate: Date.now() }
      })
    }

    poll()
    const id = setInterval(poll, gpsInterval)
    return () => { mounted = false; clearInterval(id) }
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
    return () => { mounted = false; clearInterval(id) }
  }, [enabled, relayInterval, fetchJson])

  return data
}
