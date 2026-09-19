'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Landscape immersion for phones and tablets.
 *
 * Rotating a phone/tablet to landscape should leave nothing on screen but the
 * map: no header, no ON AIR strip, no rails, no tabs, no status chips. Panels
 * come back only when something is selected (an aircraft, a report, the filter
 * sheet) and the rest of the chrome is revealed on demand.
 *
 * Two constraints shaped this:
 *
 * 1. Fullscreen cannot be entered from an orientation change. The Fullscreen API
 *    requires a user gesture, and `orientationchange` is not one. So the attempt
 *    is armed on rotation and fired on the user's first touch — otherwise the
 *    browser rejects it. Once the document has been interacted with, rotation
 *    can drive it directly.
 * 2. Only touch devices get immersion. A 1366x768 laptop is also "landscape", so
 *    gating on aspect ratio alone would hijack the desktop layout; the pointer
 *    type and the short side of the viewport do the discriminating.
 */

// Above this short-side size we assume a laptop/desktop even if a touchscreen is
// present. Covers tablets (1024x768 short side 768) but not laptops (768-800 plus
// a real keyboard, where the rails are the better layout).
const MAX_SHORT_SIDE = 900

type ImmersiveState = {
  /** True when the device is a phone/tablet held in landscape. */
  immersive: boolean
  /** True while the document is in fullscreen. */
  fullscreen: boolean
  /** True when the user has asked for the chrome back temporarily. */
  revealed: boolean
  reveal: () => void
  conceal: () => void
  toggleReveal: () => void
  /** Enter (or leave) fullscreen. Must be called from a user gesture. */
  toggleFullscreen: () => void
}

export function useImmersiveLandscape(): ImmersiveState {
  const [immersive, setImmersive] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const interacted = useRef(false)

  // ── Detection ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)')
    const compute = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const touch = coarse.matches || (navigator.maxTouchPoints ?? 0) > 0
      const shortSide = Math.min(w, h)
      setImmersive(Boolean(touch && w > h && shortSide <= MAX_SHORT_SIDE))
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('orientationchange', compute)
    coarse.addEventListener?.('change', compute)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('orientationchange', compute)
      coarse.removeEventListener?.('change', compute)
    }
  }, [])

  // ── Fullscreen state tracking ──────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: (o?: { navigationUI?: string }) => Promise<void>
    }
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.()
        return
      }
      const go = el.requestFullscreen?.({ navigationUI: 'hide' })
      void go?.catch(() => { /* gesture refused or unsupported — stay in-page */ })
      // Orientation lock only works once fullscreen is granted, and is unsupported
      // on iOS Safari. Best-effort: the CSS below handles the layout either way.
      void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
        ?.lock?.('landscape')?.catch?.(() => { /* unsupported */ })
    } catch { /* unsupported */ }
  }, [])

  // ── Arm the fullscreen attempt on rotation, fire it on the next touch ──────
  useEffect(() => {
    if (!immersive || document.fullscreenElement) return

    if (interacted.current) {
      // Rotation after any prior interaction is itself enough of a gesture
      // context for most mobile browsers; if it is refused we simply stay
      // in-page, which still hides the chrome via CSS.
      toggleFullscreen()
      return
    }

    const fire = () => {
      cleanup()
      interacted.current = true
      toggleFullscreen()
    }
    const cleanup = () => {
      window.removeEventListener('pointerdown', fire, true)
      window.removeEventListener('touchend', fire, true)
    }
    window.addEventListener('pointerdown', fire, true)
    window.addEventListener('touchend', fire, true)
    return cleanup
  }, [immersive, toggleFullscreen])

  // Any real interaction marks the session as gesture-primed.
  useEffect(() => {
    const mark = () => { interacted.current = true }
    window.addEventListener('pointerdown', mark, true)
    return () => window.removeEventListener('pointerdown', mark, true)
  }, [])

  // ── Reveal / conceal ───────────────────────────────────────────────────────
  const reveal = useCallback(() => setRevealed(true), [])
  const conceal = useCallback(() => setRevealed(false), [])
  const toggleReveal = useCallback(() => setRevealed((v) => !v), [])

  // Auto-conceal: the chrome is a detour, not a destination. Selections still open
  // their own panel and are not affected by this.
  useEffect(() => {
    if (!immersive || !revealed) return
    const t = setTimeout(() => setRevealed(false), 6000)
    return () => clearTimeout(t)
  }, [immersive, revealed])

  // Reflect state on <html> so CSS does the hiding — no prop drilling into the
  // chrome components, and no flash before React hydrates the classes.
  useEffect(() => {
    const root = document.documentElement
    const value = immersive ? (revealed ? 'revealed' : 'on') : 'off'
    root.dataset.vpImmersive = value
    if (!immersive) setRevealed(false)
    return () => { root.dataset.vpImmersive = 'off' }
  }, [immersive, revealed])

  return { immersive, fullscreen, revealed, reveal, conceal, toggleReveal, toggleFullscreen }
}
