'use client'

/**
 * useCommunityDots — polls /api/sighting/all every 5 seconds
 * and returns the current set of community dots for rendering on the map
 * and in the AR overlay.
 */

import { useState, useEffect } from 'react'
import type { CommunityDot } from '@/lib/visual-sighting'

export function useCommunityDots(intervalMs = 5000) {
  const [dots, setDots] = useState<CommunityDot[]>([])

  useEffect(() => {
    let cancelled = false

    async function fetchDots() {
      try {
        const res = await fetch('/api/sighting')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.dots)) {
          setDots(data.dots)
        }
      } catch { /* silent */ }
    }

    fetchDots()
    const id = setInterval(fetchDots, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [intervalMs])

  return dots
}
