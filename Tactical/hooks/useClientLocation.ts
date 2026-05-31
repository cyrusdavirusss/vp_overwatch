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
  hasLocation: boolean
}

/**
 * Client-only geolocation hook.
 *
 * - Requests browser geolocation once on mount via getCurrentPosition.
 * - Rounds coordinates to 3 decimal places (~100m) — approximate, not pinpoint.
 * - Never sends coordinates over the network, logs them, or persists them.
 * - Permission denied / unavailable → no hard fail, caller decides how to handle.
 */
export function useClientLocation(): UseClientLocationResult {
  const [position, setPosition] = useState<ClientLocation | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt')
  const requestedOnce = useRef(false)

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    // Round to 3 decimal places (~111m at equator) — approximate, not pinpoint
    const lat = Math.round(pos.coords.latitude * 1000) / 1000
    const lng = Math.round(pos.coords.longitude * 1000) / 1000
    setPosition({ lat, lng, accuracy: pos.coords.accuracy })
    setPermissionState('granted')
  }, [])

  const handleError = useCallback((err: GeolocationPositionError) => {
    console.warn('[GPS] geolocation error:', err.message)
    if (err.code === err.PERMISSION_DENIED) {
      setPermissionState('denied')
    } else {
      setPermissionState('unavailable')
    }
  }, [])

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setPermissionState('unavailable')
      return
    }
    navigator.geolocation.getCurrentPosition(handlePosition, handleError, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 60000,
    })
  }, [handlePosition, handleError])

  // Request location on first mount — one shot, never re-requests unless asked
  useEffect(() => {
    if (requestedOnce.current) return
    requestedOnce.current = true
    requestLocation()
  }, [requestLocation])

  const setManualLocation = useCallback((lat: number, lng: number) => {
    setPosition({ lat, lng, accuracy: 1 })
    setPermissionState('granted')
  }, [])

  return {
    position,
    permissionState,
    requestLocation,
    setManualLocation,
    hasLocation: position !== null,
  }
}
