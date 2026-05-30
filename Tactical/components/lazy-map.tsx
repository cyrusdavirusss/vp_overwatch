'use client'

import { useEffect, useState, useCallback } from 'react'
import type { VPMapProps } from './map'

type MapModule = { VPMap: React.ComponentType<VPMapProps> }

export function LazyMap(props: VPMapProps) {
  const [Module, setModule] = useState<MapModule | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setTimedOut(false)
    setModule(null)

    // Timeout after 12s
    const timer = setTimeout(() => setTimedOut(true), 12_000)

    import('./map')
      .then((mod) => {
        clearTimeout(timer)
        setModule(mod as unknown as MapModule)
      })
      .catch((err) => {
        clearTimeout(timer)
        setError(err?.message || 'Failed to load map')
      })
  }, [])

  useEffect(() => { load() }, [load])

  if (error || timedOut) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-[var(--map-bg)]">
        <div className="text-red text-sm font-mono tracking-[0.1em]">
          {error || 'MAP LOAD TIMED OUT'}
        </div>
        <div className="text-fg-4 text-xs font-mono">
          Check your connection and try again
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded bg-ink-1 border border-border text-fg-2 text-xs font-mono hover:bg-ink-2 transition-colors cursor-pointer"
        >
          RETRY
        </button>
      </div>
    )
  }

  if (!Module) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--map-bg)]">
        <div className="text-fg-3 text-sm font-mono tracking-[0.1em]">INITIALIZING MAP...</div>
      </div>
    )
  }

  return <Module.VPMap {...props} />
}
