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
 * - Coordinates are never sent over the network or persisted.
 */
export function useClientLocation(): UseClientLocationResult {
  const [position, setPosition] = useState<ClientLocation | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt')
  const [isManual, setIsManual] = useState(false)
  const watchId = useRef<number | null>(null)
  const manualUntil = useRef(0)

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    setPermissionState('granted')
    if (Date.now() < manualUntil.current) return // honour a fresh manual pin
    setIsManual(false)
    setPosition({
      lat: snapToGrid(pos.coords.latitude),
      lng: snapToGrid(pos.coords.longitude),
      accuracy: pos.coords.accuracy,
    })
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
    requestLocation()
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
    }
  }, [requestLocation])

  const setManualLocation = useCallback((lat: number, lng: number) => {
    manualUntil.current = Date.now() + 60_000 // hold the manual point ~60s
    setIsManual(true)
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
