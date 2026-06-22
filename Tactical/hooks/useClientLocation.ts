'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export interface ClientLocation {
  lat: number
  lng: number
  accuracy: number
}

export type PermissionState = 'prompt' | 'denied' | 'granted' | 'unavailable'

interface UseClientLocationResult {
  position: ClientLocation | null
  permissionState: PermissionState
  requestLocation: () => void
  setManualLocation: (lat: number, lng: number) => void
  isManual: boolean
  hasLocation: boolean
}

// Grid size for coordinate snapping. Truncating lat/lng to 3 decimal places
// rounds each accepted fix to roughly a 110 m cell, so the stored point is a
// neighbourhood-level grid square rather than the exact device position.
const GRID_DECIMALS = 3

const snapToGrid = (n: number) => Math.trunc(n * 10 ** GRID_DECIMALS) / 10 ** GRID_DECIMALS

/**
 * Client-only live geolocation hook.
 *
 * - watchPosition with maximumAge 0 gives continuous fresh fixes, so the
 *   position tracks the device as it moves.
 * - enableHighAccuracy is false: the browser may answer from the coarser
 *   network/IP source, and all fixes are accepted regardless of accuracy.
 * - Every accepted fix is snapped to a ~110 m grid (GRID_DECIMALS), so the
 *   exact device position is never stored.
 * - A manual pin briefly (60s) suppresses live updates, then GPS resumes.
 * - The grid-snapped position is pushed to the server every 10s (POST
 *   /api/gps/set) so the backend knows the user's neighbourhood-level
 *   location; the exact device position is still never stored or sent.
 */
const GPS_PUSH_INTERVAL = 10_000

export function useClientLocation(): UseClientLocationResult {
  const [position, setPosition] = useState<ClientLocation | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt')
  const [isManual, setIsManual] = useState(false)
  const watchId = useRef<number | null>(null)
  const manualUntil = useRef(0)
  // Latest fix (incl. heading) held for the periodic server push.
  const latestFix = useRef<{ lat: number; lng: number; accuracy: number; heading: number } | null>(null)

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    setPermissionState('granted')
    if (Date.now() < manualUntil.current) return // honour a fresh manual pin
    setIsManual(false)
    const lat = snapToGrid(pos.coords.latitude)
    const lng = snapToGrid(pos.coords.longitude)
    latestFix.current = {
      lat,
      lng,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading ?? 0,
    }
    setPosition({ lat, lng, accuracy: pos.coords.accuracy })
  }, [])

  const handleError = useCallback((err: GeolocationPositionError) => {
    console.warn('[GPS] geolocation error:', err.message)
    setPermissionState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
  }, [])

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setPermissionState('unavailable')
      return
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    manualUntil.current = 0
    setIsManual(false)
    watchId.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 0,
    })
  }, [handlePosition, handleError])

  useEffect(() => {
    // Clean up any pin persisted by an earlier build (deprecated behaviour).
    try { localStorage.removeItem('vp-manual-location') } catch {}

    // Fire a one-shot getCurrentPosition for a quick initial fix (fires fast on
    // mobile / desktop WiFi positioning) BEFORE watchPosition starts streaming.
    // This gets the user a map zoom-in on first load instead of waiting for the
    // slower watchPosition initial callback (~5-30 s).
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(handlePosition, () => {
        /* silent — watchPosition will try again */ }, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 30_000, // accept a cached fix up to 30 s old
      })
    }

    requestLocation()
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
    }
  }, [requestLocation])

  // Push the latest known fix to the server every 10s so the backend knows
  // roughly where the user is (used for centring the area-wide ADS-B poll).
  useEffect(() => {
    const push = () => {
      const fix = latestFix.current
      if (!fix) return
      fetch('/api/gps/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fix),
        keepalive: true,
      }).catch(() => { /* best-effort; ignore network errors */ })
    }
    const id = setInterval(push, GPS_PUSH_INTERVAL)
    return () => clearInterval(id)
  }, [])

  const setManualLocation = useCallback((lat: number, lng: number) => {
    manualUntil.current = Date.now() + 60_000 // hold the manual point ~60s
    setIsManual(true)
    latestFix.current = { lat, lng, accuracy: 1, heading: 0 }
    setPosition({ lat, lng, accuracy: 1 })
    setPermissionState('granted')
  }, [])

  return {
    position,
    permissionState,
    requestLocation,
    setManualLocation,
    isManual,
    hasLocation: position !== null,
  }
}
