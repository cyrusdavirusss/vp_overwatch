'use client'

import { Component, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { VPMapProps } from './map'

type MapModule = { VPMap: React.ComponentType<VPMapProps> }

/**
 * Backstop for anything the map throws while rendering or in its effects.
 * Without it a MapLibre failure propagates to Next's error boundary and replaces
 * the whole app with "This page couldn't load" — losing the header, the aircraft
 * list and the alerts too. Here it costs only the map area.
 */
class MapBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { failed: boolean; msg: string }
> {
  state = { failed: false, msg: '' }

  static getDerivedStateFromError(err: unknown) {
    return { failed: true, msg: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(err: unknown) {
    console.error('[VP-MAP BOUNDARY]', err)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--map-bg)] px-8 text-center">
        <div className="text-red text-sm font-mono tracking-[0.1em]">MAP UNAVAILABLE</div>
        <div className="text-fg-3 text-xs font-mono max-w-sm leading-relaxed">{this.state.msg}</div>
        <div className="text-fg-4 text-xs font-mono max-w-sm leading-relaxed">
          Alerts and aircraft are unaffected.
        </div>
        <button
          onClick={() => { this.setState({ failed: false, msg: '' }); this.props.onReset() }}
          className="px-4 py-2 rounded bg-ink-1 border border-border text-fg-2 text-xs font-mono hover:bg-ink-2 transition-colors cursor-pointer"
        >
          RETRY
        </button>
      </div>
    )
  }
}

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
    // Instant start: paint the map's own dark canvas immediately (no spinner, no
    // "INITIALIZING" text) so the hand-off to the real map is visually seamless.
    // The module is a dynamic import that resolves in a tick on a warm cache.
    return <div className="w-full h-full bg-[var(--map-bg)]" aria-hidden="true" />
  }

  return (
    <MapBoundary onReset={load}>
      <Module.VPMap {...props} />
    </MapBoundary>
  )
}
