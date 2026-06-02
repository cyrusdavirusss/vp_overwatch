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

// Fixes coarser than this (metres) are treated as IP/network guesses, not a
// real GPS lock, and are ignored — so a desktop (no GPS) rests on the home
// default instead of jumping to the ISP's city, while a phone tracks live.
const ACCURACY_MAX_M = 200

/**
 * Client-only live geolocation hook.
 *
 * - watchPosition + enableHighAccuracy + maximumAge 0: continuous fresh fixes,
 *   so the position tracks the device as it moves (phones with GPS).
 * - Coarse fixes (> ACCURACY_MAX_M) are dropped; the caller then keeps its
 *   home default. This is why a desktop stays put and only a real GPS device
 *   tracks.
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
    if (pos.coords.accuracy > ACCURACY_MAX_M) return // coarse IP/network fix — ignore
    setIsManual(false)
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
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
      enableHighAccuracy: true,
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
