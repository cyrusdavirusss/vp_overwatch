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

// Grid size for coordinate snapping, applied ONLY to the coordinates pushed to
// the server. Truncating lat/lng to 3 decimal places rounds each accepted fix to
// roughly a 110 m cell, so what leaves the device is a neighbourhood-level grid
// square rather than the exact position.
//
// The device's own copy of the fix is NOT snapped: the map draws from the raw
// coordinates so the dot moves smoothly. Snapping the drawn position made the
// marker jump in ~110 m steps and stall between them, which read as the map not
// tracking at all. Privacy belongs at the boundary — what is stored and sent —
// not between the phone and its own screen.
const GRID_DECIMALS = 3

// round, not trunc: truncating biases every pushed point toward zero, i.e.
// consistently down and left by up to a full cell.
const snapToGrid = (n: number) => Math.round(n * 10 ** GRID_DECIMALS) / 10 ** GRID_DECIMALS

/**
 * Client-only live geolocation hook.
 *
 * - watchPosition with maximumAge 0 gives continuous fresh fixes, so the
 *   position tracks the device as it moves.
 * - enableHighAccuracy is TRUE. It was false, which let the browser answer from
 *   the coarse network/IP source; on a phone in a vehicle that is the difference
 *   between a GPS fix and a suburb-level guess, and it was a large part of why
 *   tracking looked wrong.
 * - `position` carries the raw fix, for drawing.
 * - `latestFix` carries the grid-snapped fix, and is the only one transmitted
 *   (POST /api/gps/set every 10s). The exact device position is never stored or
 *   sent.
 * - A manual pin briefly (60s) suppresses live updates, then GPS resumes.
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
    // Raw coordinates for the device's own map — full precision, never leaves.
    const lat = pos.coords.latitude
    const lng = pos.coords.longitude
    // Snapped coordinates for the periodic server push — the only copy transmitted.
    latestFix.current = {
      lat: snapToGrid(lat),
      lng: snapToGrid(lng),
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
      // Real GPS. With this false the browser was free to answer from the coarse
      // network/IP source, which on a moving phone is a suburb-level guess.
      enableHighAccuracy: true,
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
