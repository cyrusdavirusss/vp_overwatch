'use client'

import { useState, useRef, useEffect } from 'react'

interface LocationSetterProps {
  onSetLocation: (lat: number, lng: number) => void
  onPickOnMap: () => void
  onClose: () => void
}

export function LocationSetter({ onSetLocation, onPickOnMap, onClose }: LocationSetterProps) {
  const [latStr, setLatStr] = useState('-37.8136')
  const [lngStr, setLngStr] = useState('144.9631')
  const [error, setError] = useState('')
  const latRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    latRef.current?.focus()
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setError('Latitude must be a number between -90 and 90')
      return
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      setError('Longitude must be a number between -180 and 180')
      return
    }

    // Client-only — no network POST. Position is held in React state.
    onSetLocation(lat, lng)
  }

  function handleUseCurrent() {
    // Browser geolocation only — no IP geo fallback, no network calls.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          setLatStr(lat.toFixed(6))
          setLngStr(lng.toFixed(6))
        },
        () => {
          setError('Could not get current location')
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-6"
      style={{
        background: 'color-mix(in srgb, var(--ink-0) 60%, transparent)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-xs rounded-xl p-4 border border-border"
        style={{
          background: 'color-mix(in srgb, var(--ink-1) 96%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-fg-1 uppercase">
            Set Location
          </span>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-fg-3 hover:text-fg-1 hover:bg-ink-2 transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div>
            <label className="block font-mono text-[9px] tracking-[0.1em] text-fg-4 uppercase mb-1">Latitude</label>
            <input
              ref={latRef}
              type="text"
              value={latStr}
              onChange={(e) => setLatStr(e.target.value)}
              placeholder="-37.8136"
              className="w-full font-mono text-[13px] text-fg-1 bg-ink-2 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--blue)] focus:ring-1 focus:ring-[var(--blue)] placeholder:text-fg-5 transition-colors"
            />
          </div>

          <div>
            <label className="block font-mono text-[9px] tracking-[0.1em] text-fg-4 uppercase mb-1">Longitude</label>
            <input
              type="text"
              value={lngStr}
              onChange={(e) => setLngStr(e.target.value)}
              placeholder="144.9631"
              className="w-full font-mono text-[13px] text-fg-1 bg-ink-2 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--blue)] focus:ring-1 focus:ring-[var(--blue)] placeholder:text-fg-5 transition-colors"
            />
          </div>

          {error && (
            <div className="font-mono text-[10px] text-[var(--red)] tracking-[0.04em]">{error}</div>
          )}

          <button
            type="button"
            onClick={onPickOnMap}
            className="w-full font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--blue)] bg-[var(--blue-wash)] border border-[var(--blue)] rounded-md py-2 mt-1 hover:bg-[var(--blue-glow)] transition-colors"
          >
            Tap location on map
          </button>

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={handleUseCurrent}
              className="flex-1 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-fg-2 bg-ink-2 border border-border rounded-md py-2 hover:bg-ink-3 hover:text-fg-1 transition-colors"
            >
              Use Current
            </button>
            <button
              type="submit"
              className="flex-1 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase text-white bg-[var(--blue)] rounded-md py-2 hover:opacity-90 transition-opacity"
            >
              Set Position
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
