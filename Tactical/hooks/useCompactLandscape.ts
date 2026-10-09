'use client'

import { useEffect, useState } from 'react'

/**
 * Landscape detection for phones and tablets.
 *
 * Rotating a phone or tablet to landscape puts the app into its COMPACT layout: the chrome is
 * scaled to THREE QUARTERS size (the `data-vp-landscape='on'` rules in vp-theme.css) so the map
 * gets more room while every control stays on screen, in its usual place, and reachable.
 *
 * THE CHROME STAYS IN FLOW, and that is the whole point of this mode. An earlier version made
 * landscape FULL-BLEED — the map ran edge to edge with the shrunken chrome floating over it — and
 * the operator's call is to have the rotation back without that. So the header and the ON AIR
 * strip keep the top, the status bar keeps the bottom, the selection sheets keep their panel, and
 * the map simply fills what is left. Nothing floats over the map and nothing is hidden.
 *
 * What this still does NOT do: request fullscreen. There used to be an arm-and-fire mechanism
 * here — on rotation it attached pointer listeners that called `requestFullscreen()` on the
 * user's next touch, because the Fullscreen API refuses a request that does not come from a
 * gesture and an orientation change is not one. Nothing ever asked for fullscreen, it fired on
 * the first tap anywhere on a landscape phone, and once the reveal/fullscreen tab was removed
 * there was no longer any UI to leave it — so a stray tap could put the browser in fullscreen
 * with no way out but the browser's own control. Fullscreen is gone from this app entirely, and
 * this hook must NOT reintroduce it.
 *
 * Only touch devices qualify. A 1366x768 laptop is also "landscape", so gating on aspect ratio
 * alone would hijack the desktop layout; the pointer type and the short side do the
 * discriminating.
 */

// Above this short-side size we assume a laptop/desktop even if a touchscreen is
// present. Covers tablets (1024x768 short side 768) but not laptops (768-800 plus
// a real keyboard, where the rails are the better layout).
const MAX_SHORT_SIDE = 900

type CompactState = {
  /** True when the device is a phone/tablet held in landscape. */
  compact: boolean
}

export function useCompactLandscape(): CompactState {
  const [compact, setCompact] = useState(false)

  // ── Detection ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)')
    const compute = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const touch = coarse.matches || (navigator.maxTouchPoints ?? 0) > 0
      const shortSide = Math.min(w, h)
      setCompact(Boolean(touch && w > h && shortSide <= MAX_SHORT_SIDE))
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

  // Reflect state on <html> so CSS does the scaling — no prop drilling into the chrome components,
  // and no flash before React hydrates the classes. The value carries the meaning ('on' vs 'off'),
  // which is what the CSS tests.
  useEffect(() => {
    document.documentElement.dataset.vpLandscape = compact ? 'on' : 'off'
    return () => { document.documentElement.dataset.vpLandscape = 'off' }
  }, [compact])

  return { compact }
}
