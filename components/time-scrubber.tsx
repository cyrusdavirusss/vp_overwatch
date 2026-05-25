'use client'

import { useRef, useState, useMemo, useCallback } from 'react'
import { Icon } from './icon'
import { Aircraft, Report, sampleTrack, formatSec, clockAt } from '@/lib/data'

interface TimeScrubberProps {
  aircraft: Aircraft[]
  reports: Report[]
  value: number // seconds ago (0 = now)
  onChange: (value: number) => void
  windowSec?: number // default 60 minutes
}

export function TimeScrubber({
  aircraft,
  reports,
  value,
  onChange,
  windowSec = 3600,
}: TimeScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  draggingRef.current = dragging

  const isLive = value < 0.5

  // Build activity histogram - 60 buckets, one per minute
  const histogram = useMemo(() => {
    const buckets = new Array(60).fill(0)
    aircraft.forEach((a) => {
      for (let m = 0; m < 60; m++) {
        const t = m * 60
        const pos = sampleTrack(a.track, t)
        if (pos) buckets[m] += 1
      }
    })
    reports.forEach((r) => {
      const reportedMin = Math.floor(r.reportedAgo / 60)
      if (reportedMin < 60) buckets[reportedMin] += 1.5
    })
    const max = Math.max(...buckets, 1)
    return buckets.map((b) => b / max)
  }, [aircraft, reports])

  const pctFromValue = (v: number) =>
    100 * (1 - Math.min(1, Math.max(0, v / windowSec)))

  const handlePointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
      const u = 1 - x / rect.width // 0 = now (right), 1 = oldest (left)
      let secondsAgo = u * windowSec
      // Magnetic snap to now within 15s
      if (secondsAgo < 15) secondsAgo = 0
      onChange(secondsAgo)
    },
    [windowSec, onChange]
  )

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true)
    trackRef.current?.setPointerCapture(e.pointerId)
    handlePointer(e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    handlePointer(e.clientX)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    setDragging(false)
    trackRef.current?.releasePointerCapture(e.pointerId)
  }

  const playheadPct = pctFromValue(value)

  return (
    <div
      className="px-3.5 pt-2 pb-3"
      style={{
        background: 'color-mix(in srgb, var(--ink-1) 88%, transparent)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-baseline gap-2.5">
          <span className="num text-[13px] font-semibold text-fg-1 tracking-[0.04em]">
            {isLive ? 'LIVE' : `−${formatSec(value)}`}
          </span>
          <span className="num text-[11px] text-fg-3 tracking-[0.02em]">
            {clockAt(value)}
          </span>
        </div>
        <button
          className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full font-mono text-[10px] font-semibold tracking-[0.1em] uppercase transition-all ${
            isLive
              ? 'text-[var(--blue)] cursor-default'
              : 'bg-[var(--blue)] text-white hover:bg-[var(--blue-hi)] active:scale-[0.97]'
          }`}
          onClick={() => onChange(0)}
        >
          {isLive ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)] animate-pulse" />
              <span>LIVE</span>
            </>
          ) : (
            <>
              <Icon name="play" size={11} fill="currentColor" />
              <span>SNAP TO NOW</span>
            </>
          )}
        </button>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className={`relative h-14 touch-none cursor-ew-resize ${
          dragging ? 'is-dragging' : ''
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Tick grid */}
        <div className="absolute inset-0">
          {[0, 15, 30, 45, 60].map((m) => (
            <div
              key={m}
              className="absolute top-0 bottom-0"
              style={{
                left: `${100 - (m / 60) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <span
                className="absolute bottom-1.5 left-0 num text-[9px] text-fg-4 whitespace-nowrap tracking-[0.02em]"
                style={{ transform: 'translateX(-50%)' }}
              >
                −{m}m
              </span>
              <span className="absolute bottom-0 left-0 w-px h-1 bg-border" style={{ transform: 'translateX(-50%)' }} />
            </div>
          ))}
        </div>

        {/* Histogram bars */}
        <div className="absolute left-0 right-0 bottom-3 h-[calc(56px-12px)]">
          {histogram.map((v, i) => (
            <div
              key={i}
              className="absolute bottom-0 w-1 rounded-t-sm bg-ink-4 transition-colors"
              style={{
                left: `${100 - ((i + 0.5) / 60) * 100}%`,
                height: `${10 + v * 70}%`,
                transform: 'translateX(-50%)',
              }}
            />
          ))}
        </div>

        {/* Ghost now marker when not at live */}
        {!isLive && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: '100%', transform: 'translateX(-50%)' }}
          >
            <div
              className="absolute top-0 bottom-3 left-0 w-px opacity-40"
              style={{
                background: 'var(--blue)',
                boxShadow: '0 0 6px var(--blue-glow)',
              }}
            />
            <span
              className="absolute -top-0.5 left-0 num text-[9px] font-semibold text-[var(--blue)] tracking-[0.1em] opacity-70"
              style={{ transform: 'translateX(-100%) translateX(-4px)' }}
            >
              NOW
            </span>
          </div>
        )}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0"
          style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
        >
          <div
            className={`absolute top-0 bottom-3 left-0 w-[1.5px] ${
              isLive ? 'shadow-lg' : ''
            }`}
            style={{
              background: 'var(--blue)',
              boxShadow: '0 0 8px var(--blue-glow)',
            }}
          />
          <div
            className={`absolute -top-0.5 left-0 w-5 h-5 rounded-full bg-[var(--blue)] flex items-center justify-center transition-transform ${
              dragging ? 'scale-[1.15]' : ''
            }`}
            style={{
              transform: 'translateX(-50%)',
              boxShadow:
                '0 0 0 4px color-mix(in srgb, var(--blue) 18%, transparent), 0 2px 8px rgba(0,0,0,0.5)',
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </div>
      </div>
    </div>
  )
}
