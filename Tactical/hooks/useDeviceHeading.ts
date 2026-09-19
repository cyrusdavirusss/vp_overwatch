'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Device compass heading, for driving the map's bearing in head-up mode.
 *
 * Three things make this less trivial than subscribing to `deviceorientation`:
 *
 * 1. iOS will not deliver any motion data until `requestPermission()` is called
 *    from inside a user gesture. The permission cannot be requested on mount —
 *    it has to be armed by a tap, so `start()` is exposed for a button to call.
 *
 * 2. There are two different angle sources. iOS gives `webkitCompassHeading`,
 *    already a clockwise-from-north compass bearing. Everyone else gives
 *    `alpha` on `deviceorientationabsolute`, which runs the other way round
 *    (heading = 360 - alpha). Neither exists on desktop, where this returns
 *    `supported: false` and the control is not shown.
 *
 * 3. The screen can be rotated. Holding the phone in landscape means the top
 *    edge of the screen no longer faces the direction of travel, so the raw
 *    compass heading has to be compensated by `screen.orientation.angle` or
 *    the map points 90 degrees off in landscape.
 *
 * Heading is smoothed with a circular low-pass, because a raw compass jitters
 * by several degrees frame to frame and a map that twitches is worse than one
 * that lags slightly.
 */

export type HeadingState = {
  /** Degrees clockwise from north, screen-top relative, or null if unknown. */
  heading: number | null
  /**
   * Same value, updated every animation frame. The map reads this directly in its
   * own frame loop rather than going through React state — a 60 Hz state update
   * would re-render the entire app 60 times a second.
   */
  headingRef: React.MutableRefObject<number | null>
  /** True once data is actually arriving. */
  active: boolean
  /** True when the device exposes orientation events at all (false on desktop). */
  supported: boolean
  /** True when a tap is required before any data will arrive (iOS). */
  needsPermission: boolean
  /** True when permission was refused. */
  denied: boolean
  start: () => Promise<void>
  stop: () => void
}

const wrap = (d: number) => ((d % 360) + 360) % 360

/** Circular smoothing — interpolate the short way round, never across 0/360. */
function blend(prev: number, next: number, k: number): number {
  let diff = wrap(next - prev)
  if (diff > 180) diff -= 360
  return wrap(prev + diff * k)
}

function screenAngle(): number {
  if (typeof screen === 'undefined') return 0
  const a = (screen.orientation as ScreenOrientation & { angle?: number })?.angle
  return typeof a === 'number' ? a : 0
}

export function useDeviceHeading(): HeadingState {
  const [heading, setHeading] = useState<number | null>(null)
  const [active, setActive] = useState(false)
  const [denied, setDenied] = useState(false)
  // Capability checks must not run during render: `'DeviceOrientationEvent' in window`
  // is false on the server and true on the client, so computing it inline produced a
  // hydration mismatch (React #418) and the audience-sensitive markup differed.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const running = useRef(false)
  const raw = useRef<number | null>(null)
  const shown = useRef<number | null>(null)
  const live = useRef<number | null>(null)
  const lastPush = useRef(0)
  const raf = useRef<number | null>(null)
  const gotAny = useRef(false)

  const supported = mounted && 'DeviceOrientationEvent' in window
  const needsPermission = supported &&
    typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === 'function'

  const onOrient = useCallback((e: DeviceOrientationEvent) => {
    const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
    let deg: number | null = null
    if (typeof compass === 'number' && !Number.isNaN(compass)) {
      deg = compass                      // iOS: already a compass bearing
    } else if (e.alpha != null) {
      deg = 360 - e.alpha                // W3C alpha runs anticlockwise
    }
    if (deg == null) return
    gotAny.current = true
    raw.current = wrap(deg + screenAngle())
  }, [])

  const stop = useCallback(() => {
    running.current = false
    window.removeEventListener('deviceorientationabsolute', onOrient as EventListener, true)
    window.removeEventListener('deviceorientation', onOrient as EventListener, true)
    if (raf.current != null) cancelAnimationFrame(raf.current)
    raf.current = null
    shown.current = null
    live.current = null
    setActive(false)
    setHeading(null)
  }, [onOrient])

  const start = useCallback(async () => {
    if (!supported || running.current) return
    try {
      if (needsPermission) {
        const res = await (window.DeviceOrientationEvent as unknown as {
          requestPermission: () => Promise<string>
        }).requestPermission()
        if (res !== 'granted') {
          setDenied(true)
          return
        }
      }
    } catch {
      setDenied(true)
      return
    }

    gotAny.current = false
    running.current = true
    // absolute is preferred (it is a true compass); plain event is the fallback
    window.addEventListener('deviceorientationabsolute', onOrient as EventListener, true)
    window.addEventListener('deviceorientation', onOrient as EventListener, true)

    const tick = () => {
      if (!running.current) return
      const r = raw.current
      if (r != null) {
        shown.current = shown.current == null ? r : blend(shown.current, r, 0.18)
        // every frame for the map, which reads headingRef in its own loop
        live.current = shown.current
        // throttled for the needle: ~8 Hz is smooth for an 18px icon and keeps
        // the rest of the app from re-rendering at frame rate
        const now = Date.now()
        if (now - lastPush.current > 120) {
          lastPush.current = now
          setHeading(Math.round(shown.current))
        }
        if (!active) setActive(true)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    // If nothing arrives shortly, say so rather than pretending to be active.
    setTimeout(() => {
      if (running.current && !gotAny.current) {
        stop()
        setDenied(true)
      }
    }, 2500)
  }, [active, needsPermission, onOrient, stop, supported])

  useEffect(() => stop, [stop])

  return { heading, headingRef: live, active, supported, needsPermission, denied, start, stop }
}
