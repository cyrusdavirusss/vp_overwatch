'use client'

/**
 * useRouteAlerts — React hook for real-time route proximity alerting
 *
 * Analyses the user's current route against all live aircraft and ground
 * units every time the data changes.  Returns a RouteAlertResult that
 * can be passed directly to <RouteAlertPanel />.
 *
 * Usage:
 *   const { result, setRoute, route } = useRouteAlerts(aircraft, reports, userLat, userLng)
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { analyseRoute, type RouteAlertResult } from '@/lib/route-alerts'
import type { Aircraft, Report } from '@/lib/store'

export interface RouteWaypoint { lat: number; lng: number }

const EMPTY_RESULT: RouteAlertResult = {
  alerts: [], headline: null, hasCritical: false, hasHigh: false,
}

export function useRouteAlerts(
  aircraft: Aircraft[],
  reports: Report[],
  userLat: number,
  userLng: number,
  /** Half-width of the corridor in metres (default 2km) */
  corridorM = 2000,
) {
  const [route, setRoute] = useState<RouteWaypoint[]>([])
  const [destination, setDestination] = useState<RouteWaypoint | null>(null)

  // When user sets a destination, build a simple 2-point route from current position
  const effectiveRoute = useMemo<RouteWaypoint[]>(() => {
    if (route.length >= 2) return route
    if (destination && userLat !== 0 && userLng !== 0) {
      return [{ lat: userLat, lng: userLng }, destination]
    }
    return []
  }, [route, destination, userLat, userLng])

  const result = useMemo<RouteAlertResult>(() => {
    if (effectiveRoute.length < 2 && aircraft.length === 0 && reports.length === 0) {
      return EMPTY_RESULT
    }
    return analyseRoute(userLat, userLng, effectiveRoute, aircraft, reports, corridorM)
  }, [aircraft, reports, userLat, userLng, effectiveRoute, corridorM])

  /** Set destination from a map click (single point → 2-point route) */
  const setDestinationPoint = useCallback((lat: number, lng: number) => {
    setDestination({ lat, lng })
    setRoute([]) // Clear any existing multi-point route
  }, [])

  /** Set a full multi-point route (e.g. from a navigation API) */
  const setFullRoute = useCallback((waypoints: RouteWaypoint[]) => {
    setRoute(waypoints)
    setDestination(null)
  }, [])

  /** Clear the route */
  const clearRoute = useCallback(() => {
    setRoute([])
    setDestination(null)
  }, [])

  return {
    result,
    route: effectiveRoute,
    destination,
    setDestinationPoint,
    setFullRoute,
    clearRoute,
    hasRoute: effectiveRoute.length >= 2,
  }
}
