'use client'

// ON AIR bar — persistent, always-visible airframe indicator.
//
// Goes loud (Aviation Amber) when one or more law enforcement aircraft are
// airborne, stays quiet when clear. Pages between active airframes
// (rotary / fixed-wing each get their own card) showing callsign, distance,
// bearing, altitude, speed, and data freshness. Tapping a card selects that
// aircraft on the map. Swipe or use the arrows to change airframe.
//
// Deliberately fed the UNFILTERED aircraft list — layer filters must never
// hide an airborne unit from the safety bar.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Icon } from './icon'
import {
  Aircraft,
  User,
  computeDistance,
  computeBearing,
  compassFromBearing,
} from '@/lib/data'

const AUTO_CYCLE_MS = 7_000
const INTERACT_HOLD_MS = 15_000

interface OnAirBarProps {
  aircraft: Aircraft[]
  user: User
  selectedAircraftId: string | null
  onSelectAircraft: (id: string | null) => void
  now: number
  compact?: boolean
}

type FreshTone = 'live' | 'aging' | 'stale' | 'lost'

function freshness(a: Aircraft, now: number): { label: string; tone: FreshTone } {
  if (a.lastSeen == null) return { label: 'LOST', tone: 'lost' }
  const age = (now - a.lastSeen) / 1000
  if (age < 60) return { label: 'LIVE', tone: 'live' }
  if (age < 120) return { label: '<2m', tone: 'aging' }
  if (age < 600) return { label: 'STALE', tone: 'stale' }
  return { label: 'LOST', tone: 'lost' }
}

const FRESH_COLOR: Record<FreshTone, string> = {
  live: 'var(--green)',
  aging: 'var(--amber)',
  stale: 'var(--stale)',
  lost: 'var(--red)',
}

export function OnAirBar({
  aircraft,
  user,
  selectedAircraftId,
  onSelectAircraft,
  now,
  compact = false,
}: OnAirBarProps) {
  // Active airframes, nearest threat first.
  const active = useMemo(() => {
    return aircraft
      .filter((a) => a.isActive)
      .map((a) => ({
        a,
        distNm: computeDistance(user.lat, user.lng, a.latitude, a.longitude) / 1852,
        bearing: computeBearing(user.lat, user.lng, a.latitude, a.longitude),
      }))
      .sort((x, y) => x.distNm - y.distNm)
  }, [aircraft, user.lat, user.lng])

  const silent = useMemo(
    () => aircraft.filter((a) => !a.isActive && a.lastSeen !== null).length,
    [aircraft]
  )

  // Pager keyed by aircraft id so list re-sorting never jumps the card.
  const [activeId, setActiveId] = useState<string | null>(null)
  const lastInteract = useRef(0)

  const idx = Math.max(0, active.findIndex((e) => e.a.id === activeId))
  const current = active[idx] ?? active[0] ?? null

  // Keep activeId valid as aircraft come and go.
  useEffect(() => {
    if (active.length === 0) {
      if (activeId !== null) setActiveId(null)
      return
    }
    if (!active.some((e) => e.a.id === activeId)) setActiveId(active[0].a.id)
  }, [active, activeId])

  // Sync pager to map selection when the selected aircraft is airborne.
  useEffect(() => {
    if (selectedAircraftId && active.some((e) => e.a.id === selectedAircraftId)) {
      setActiveId(selectedAircraftId)
    }
  }, [selectedAircraftId, active])

  // Auto-cycle through airframes when idle and nothing is selected.
  useEffect(() => {
    if (active.length < 2) return
    const id = setInterval(() => {
      if (selectedAircraftId) return
      if (Date.now() - lastInteract.current < INTERACT_HOLD_MS) return
      setActiveId((prev) => {
        const i = Math.max(0, active.findIndex((e) => e.a.id === prev))
        return active[(i + 1) % active.length].a.id
      })
    }, AUTO_CYCLE_MS)
    return () => clearInterval(id)
  }, [active, selectedAircraftId])

  const page = useCallback(
    (dir: 1 | -1) => {
      if (active.length === 0) return
      lastInteract.current = Date.now()
      setActiveId((prev) => {
        const i = Math.max(0, active.findIndex((e) => e.a.id === prev))
        return active[(i + dir + active.length) % active.length].a.id
      })
    },
    [active]
  )

  // Touch swipe.
  const touchX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 40) page(dx < 0 ? 1 : -1)
  }

  const onAir = active.length > 0
  const barH = compact ? 52 : 48

  return (
    <div
      className="relative flex items-stretch w-full flex-shrink-0 select-none"
      style={{
        height: barH,
        background: onAir
          ? 'linear-gradient(90deg, var(--amber-wash) 0%, var(--ink-1) 38%)'
          : 'var(--ink-1)',
        borderBottom: `1px solid ${onAir ? 'var(--amber-lo)' : 'var(--border)'}`,
        boxShadow: onAir ? 'inset 3px 0 0 var(--amber)' : 'inset 3px 0 0 transparent',
        transition: 'background var(--dur-panel) var(--ease-spring), border-color var(--dur-panel) var(--ease-spring)',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="status"
      aria-live="polite"
    >
      <style>{`
        @keyframes onair-card-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes onair-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      {/* State badge */}
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0"
        style={{ minWidth: compact ? 88 : 104 }}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            background: onAir ? 'var(--amber)' : 'var(--blue)',
            boxShadow: onAir ? '0 0 8px var(--amber-glow), 0 0 2px var(--amber)' : 'none',
            animation: onAir ? 'onair-pulse 1.6s ease-in-out infinite' : 'none',
          }}
        />
        <span
          className="font-mono font-bold tracking-[0.16em] uppercase leading-none"
          style={{
            fontSize: compact ? 12 : 13,
            color: onAir ? 'var(--amber)' : 'var(--fg-3)',
          }}
        >
          {onAir ? 'ON AIR' : 'CLEAR'}
        </span>
      </div>

      <div className="w-px self-stretch my-2" style={{ background: 'var(--border)' }} />

      {/* Card region */}
      {onAir && current ? (
        <button
          key={current.a.id}
          className="flex items-center gap-3 px-3 flex-1 min-w-0 text-left cursor-pointer"
          style={{ animation: 'onair-card-in var(--dur-panel) var(--ease-spring)' }}
          onClick={() => {
            lastInteract.current = Date.now()
            onSelectAircraft(current.a.id)
          }}
          aria-label={`Select ${current.a.callsign} on map`}
        >
          <span className="flex-shrink-0" style={{ color: 'var(--amber)' }}>
            <Icon
              name={current.a.role === 'rotary' ? 'helicopter' : 'plane'}
              size={compact ? 18 : 20}
            />
          </span>

          <div className="flex flex-col gap-0.5 min-w-0 flex-shrink-0">
            <span
              className="num font-bold leading-none tracking-[0.04em]"
              style={{ fontSize: compact ? 14 : 15, color: 'var(--fg-1)' }}
            >
              {current.a.callsign}
            </span>
            <span
              className="font-mono leading-none uppercase tracking-[0.06em] truncate"
              style={{ fontSize: 8.5, color: 'var(--fg-3)' }}
            >
              {current.a.typeLabel} · {current.a.operatorShort}
            </span>
          </div>

          <div className="w-px self-stretch my-1.5" style={{ background: 'var(--border-subtle)' }} />

          <div className="flex items-center gap-3 min-w-0 overflow-hidden">
            <Readout label="dist" value={`${current.distNm.toFixed(1)}nm`} hot={current.distNm < 3} />
            <Readout
              label="brg"
              value={`${String(Math.round(current.bearing)).padStart(3, '0')}° ${compassFromBearing(current.bearing)}`}
            />
            {!compact && <Readout label="alt" value={`${current.a.altitude.toLocaleString()}ft`} />}
            <Readout label="spd" value={`${Math.round(current.a.speed)}kts`} />
          </div>

          <span
            className="ml-auto font-mono font-semibold leading-none tracking-[0.1em] uppercase flex-shrink-0"
            style={{ fontSize: 9, color: FRESH_COLOR[freshness(current.a, now).tone] }}
          >
            {freshness(current.a, now).label}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2.5 px-3 flex-1 min-w-0">
          <span
            className="font-mono leading-none tracking-[0.08em] uppercase truncate"
            style={{ fontSize: 9.5, color: 'var(--fg-4)' }}
          >
            No law enforcement aircraft airborne
          </span>
          {silent > 0 && (
            <>
              <span className="w-px h-3" style={{ background: 'var(--border)' }} />
              <span
                className="font-mono leading-none tracking-[0.08em] uppercase flex-shrink-0"
                style={{ fontSize: 9.5, color: 'var(--fg-3)' }}
              >
                <span className="num font-semibold" style={{ color: 'var(--amber)' }}>{silent}</span> silent
              </span>
            </>
          )}
        </div>
      )}

      {/* Pager */}
      {active.length > 1 && (
        <div className="flex items-center gap-1.5 px-2 flex-shrink-0">
          <PagerBtn dir={-1} onClick={() => page(-1)} />
          <div className="flex items-center gap-1">
            {active.map((e, i) => (
              <span
                key={e.a.id}
                className="rounded-full"
                style={{
                  width: 5,
                  height: 5,
                  background: i === idx ? 'var(--amber)' : 'var(--ink-3)',
                  transition: 'background var(--dur-fast, 120ms) var(--ease-spring)',
                }}
              />
            ))}
          </div>
          <PagerBtn dir={1} onClick={() => page(1)} />
          <span className="num leading-none ml-0.5" style={{ fontSize: 9, color: 'var(--fg-4)' }}>
            {idx + 1}/{active.length}
          </span>
        </div>
      )}
    </div>
  )
}

function Readout({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="flex items-baseline gap-1 flex-shrink-0">
      <span
        className="font-mono leading-none lowercase tracking-[0.04em]"
        style={{ fontSize: 8.5, color: 'var(--fg-4)' }}
      >
        {label}
      </span>
      <span
        className="num font-semibold leading-none"
        style={{ fontSize: 12, color: hot ? 'var(--amber)' : 'var(--fg-2)' }}
      >
        {value}
      </span>
    </div>
  )
}

function PagerBtn({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded border"
      style={{ background: 'var(--ink-2)', borderColor: 'var(--border)', color: 'var(--fg-2)' }}
      aria-label={dir === 1 ? 'Next aircraft' : 'Previous aircraft'}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {dir === 1 ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
      </svg>
    </button>
  )
}
