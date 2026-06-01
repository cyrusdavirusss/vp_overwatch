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
  clearManualLocation: () => void
  isManual: boolean
  hasLocation: boolean
}

const PIN_KEY = 'vp-manual-location'

/**
 * Client-only geolocation hook.
 *
 * Two modes:
 *  - Auto: watchPosition with enableHighAccuracy, keeping the tightest fix.
 *    Good on devices with GPS (phones). On a desktop browser this is only as
 *    accurate as the OS/IP can manage — often kilometres off, which no setting
 *    can fix.
 *  - Manual pin: a deliberately-set location that PERSISTS (localStorage) and
 *    LOCKS — auto geolocation will not override it. This is the reliable path
 *    for desktop. Cleared explicitly via clearManualLocation().
 *
 * Coordinates are never sent over the network; the only persistence is the
 * manual pin the user sets on purpose.
 */
export function useClientLocation(): UseClientLocationResult {
  const [position, setPosition] = useState<ClientLocation | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt')
  const [isManual, setIsManual] = useState(false)
  const watchId = useRef<number | null>(null)
  const bestAccuracy = useRef<number>(Infinity)
  const manualLock = useRef(false)
  const startedOnce = useRef(false)

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
  }, [])

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    if (manualLock.current) return // a manual pin always wins
    const acc = pos.coords.accuracy
    // Keep the tightest fix; ignore a later, much coarser reading (e.g. an IP
    // fallback arriving after a good GPS lock).
    if (acc > bestAccuracy.current * 1.5 && bestAccuracy.current < 100) return
    bestAccuracy.current = Math.min(bestAccuracy.current, acc)
    setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc })
    setPermissionState('granted')
  }, [])

  const handleError = useCallback((err: GeolocationPositionError) => {
    console.warn('[GPS] geolocation error:', err.message)
    setPermissionState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
  }, [])

  // Start (or restart) the live auto watch. Clears any manual lock.
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setPermissionState('unavailable')
      return
    }
    manualLock.current = false
    setIsManual(false)
    try { localStorage.removeItem(PIN_KEY) } catch {}
    stopWatch()
    bestAccuracy.current = Infinity
    watchId.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })
  }, [handlePosition, handleError, stopWatch])

  const setManualLocation = useCallback((lat: number, lng: number) => {
    stopWatch()
    manualLock.current = true
    setIsManual(true)
    try { localStorage.setItem(PIN_KEY, JSON.stringify({ lat, lng })) } catch {}
    setPosition({ lat, lng, accuracy: 1 })
    setPermissionState('granted')
  }, [stopWatch])

  const clearManualLocation = useCallback(() => {
    try { localStorage.removeItem(PIN_KEY) } catch {}
    requestLocation()
  }, [requestLocation])

  // On first mount: a saved pin wins and locks; otherwise start the auto watch.
  useEffect(() => {
    if (startedOnce.current) return
    startedOnce.current = true

    let saved: { lat: number; lng: number } | null = null
    try {
      const raw = localStorage.getItem(PIN_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (typeof p?.lat === 'number' && typeof p?.lng === 'number') saved = p
      }
    } catch {}

    if (saved) {
      manualLock.current = true
      setIsManual(true)
      setPosition({ lat: saved.lat, lng: saved.lng, accuracy: 1 })
      setPermissionState('granted')
      return // do not start auto-watch; the pin is authoritative
    }

    if (!navigator.geolocation) {
      setPermissionState('unavailable')
      return
    }
    bestAccuracy.current = Infinity
    watchId.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })

    return () => stopWatch()
  }, [handlePosition, handleError, stopWatch])

  // Always clean up the watch on unmount.
  useEffect(() => stopWatch, [stopWatch])

  return {
    position,
    permissionState,
    requestLocation,
    setManualLocation,
    clearManualLocation,
    isManual,
    hasLocation: position !== null,
  }
}
