'use client'

import { useState, useEffect, useMemo } from 'react'
import { Icon } from './icon'
import { Metric, Chip } from './ui'
import {
  Aircraft,
  TrackPoint,
  sampleTrack,
  computeDistance,
  computeBearing,
  compassFromBearing,
  formatSec,
  formatHMS,
  formatHM,
  USER,
} from '@/lib/data'

interface AircraftDetailProps {
  aircraft: Aircraft
  scrubT: number
  onClose: () => void
}

export function AircraftDetail({ aircraft, scrubT, onClose }: AircraftDetailProps) {
  const pos = sampleTrack(aircraft.track, scrubT)
  if (!pos) return null

  const distNm = computeDistance(USER.lat, USER.lng, pos.lat, pos.lng) / 1852
  const bearing = computeBearing(USER.lat, USER.lng, pos.lat, pos.lng)
  const trackedMin = Math.floor((aircraft.track.length * 4) / 60)
  const trend = pos.vs > 50 ? 'climb' : pos.vs < -50 ? 'descend' : 'level'

  // Sparkline data - altitude over last 15 minutes
  const sparkData = useMemo(() => {
    const out: number[] = []
    for (let m = 0; m < 15; m++) {
      const t = scrubT + m * 60
      const p = sampleTrack(aircraft.track, t)
      if (p) out.push(p.alt)
    }
    return out.reverse()
  }, [aircraft, scrubT])

  return (
    <div className="bg-ink-1 border border-border rounded-lg p-4 mx-3">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-col gap-0.5">
          <div className="num text-[22px] font-semibold text-fg-1 tracking-[0.04em] leading-none">
            {aircraft.callsign}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fg-3">
            <span className="num font-medium text-fg-2 tracking-[0.06em]">
              {aircraft.hex}
            </span>
            <span className="text-fg-4">·</span>
            <span>{aircraft.type}</span>
          </div>
        </div>
        <button
          className="w-8 h-8 flex items-center justify-center bg-ink-2 border border-border text-fg-2 rounded-md hover:bg-ink-3 hover:text-fg-1 transition-colors"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      {/* Operator */}
      <div className="flex items-center gap-2 mb-3.5 text-xs text-fg-2">
        <Chip variant="aircraft">{aircraft.operatorShort}</Chip>
        <span>{aircraft.operator}</span>
      </div>

      {/* Flight Timer */}
      <FlightTimer
        timeAirborneSeconds={aircraft.timeAirborneSeconds}
        estimatedReturnSeconds={aircraft.estimatedReturnSeconds}
        historicalAverageSeconds={aircraft.historicalAverageSeconds}
      />

      {/* Primary metrics grid */}
      <div
        className="grid grid-cols-4 gap-px rounded-md overflow-hidden mb-3.5"
        style={{ background: 'var(--border-subtle)' }}
      >
        <Metric label="alt" value={pos.alt.toLocaleString()} unit="ft" trend={trend} />
        <Metric label="spd" value={pos.spd.toFixed(0)} unit="kts" />
        <Metric label="hdg" value={String(pos.hdg).padStart(3, '0')} unit="°" />
        <Metric
          label="v/s"
          value={pos.vs >= 0 ? `+${Math.abs(pos.vs)}` : `−${Math.abs(pos.vs)}`}
          unit="ft/m"
          tone={pos.vs > 50 ? 'green' : pos.vs < -50 ? 'amber' : 'default'}
        />
      </div>

      {/* Sparkline */}
      <div className="bg-ink-2 border border-border rounded-md p-2.5 mb-3.5">
        <div className="flex items-baseline justify-between mb-2">
          <span className="t-label">Altitude · last 15m</span>
          <span className="num text-[10px] text-fg-3">
            {Math.min(...sparkData).toLocaleString()} – {Math.max(...sparkData).toLocaleString()}ft
          </span>
        </div>
        <Sparkline data={sparkData} height={48} />
      </div>

      {/* Secondary stats */}
      <div className="flex gap-4 pt-3 border-t border-border-subtle">
        <SecondaryStat label="tracked" value={`${trackedMin}m`} />
        <SecondaryStat label="distance" value={`${distNm.toFixed(1)}nm`} />
        <SecondaryStat
          label="bearing"
          value={`${String(Math.round(bearing)).padStart(3, '0')}° ${compassFromBearing(bearing)}`}
        />
      </div>
    </div>
  )
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1">
      <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3 mb-1">
        {label}
      </div>
      <div className="num text-[13px] font-medium text-fg-1 tracking-[0.02em]">
        {value}
      </div>
    </div>
  )
}

function Sparkline({ data, height = 48 }: { data: number[]; height?: number }) {
  if (!data || data.length === 0) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = Math.max(1, max - min)
  const W = 280

  const stepX = W / (data.length - 1 || 1)
  const points = data
    .map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 8) - 4}`)
    .join(' ')
  const linePath = `M ${points.split(' ').join(' L ')}`
  const areaPath = `M 0,${height} L ${points.split(' ').join(' L ')} L ${(data.length - 1) * stepX},${height} Z`

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-grad)" />
      <path
        d={linePath}
        stroke="var(--amber)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(data.length - 1) * stepX}
        cy={height - ((data[data.length - 1] - min) / range) * (height - 8) - 4}
        r="3"
        fill="var(--amber)"
      />
    </svg>
  )
}

// Flight Timer component
function FlightTimer({
  timeAirborneSeconds,
  estimatedReturnSeconds,
  historicalAverageSeconds,
}: {
  timeAirborneSeconds: number
  estimatedReturnSeconds: number
  historicalAverageSeconds: number
}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const liveAirborne = timeAirborneSeconds + tick
  const liveReturn = Math.max(0, estimatedReturnSeconds - tick)
  const total = liveAirborne + liveReturn
  const pct = Math.min(1, liveAirborne / Math.max(total, 1))
  const overrun = liveAirborne > historicalAverageSeconds

  return (
    <div className="bg-ink-2 border border-border rounded-md p-3 mb-3.5">
      {/* Header */}
      <div className="flex items-start justify-between mb-2.5">
        <div className="flex-1">
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3 mb-0.5">
            airborne
          </div>
          <div className="num text-lg font-semibold text-fg-1 leading-none tracking-[-0.01em]">
            {formatHMS(liveAirborne)}
          </div>
        </div>
        <div
          className="text-center px-2 mx-2"
          style={{ borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}
        >
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3 mb-0.5">
            historical avg
          </div>
          <div className="num text-[13px] font-medium text-fg-2 leading-tight">
            {formatHM(historicalAverageSeconds)}
          </div>
        </div>
        <div className="flex-1 text-right">
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3 mb-0.5">
            est. return in
          </div>
          <div className="num text-lg font-semibold text-fg-1 leading-none tracking-[-0.01em]">
            {formatHMS(liveReturn)}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 bg-ink-3 rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 bottom-0 rounded-full transition-[width] duration-700"
          style={{
            width: `${pct * 100}%`,
            background: 'linear-gradient(90deg, var(--amber-lo), var(--amber))',
            boxShadow: '0 0 8px var(--amber-glow)',
          }}
        />
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-fg-1/70"
          style={{
            left: `${(historicalAverageSeconds / Math.max(total, historicalAverageSeconds)) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        />
        {overrun && (
          <div
            className="absolute top-0 bottom-0 right-0 opacity-70"
            style={{
              width: `${((liveAirborne - historicalAverageSeconds) / historicalAverageSeconds) * 100}%`,
              background: 'repeating-linear-gradient(-45deg, var(--red) 0 4px, transparent 4px 8px)',
            }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-1.5 font-mono text-[9.5px] text-fg-3 tracking-[0.02em]">
        <span className="num">0:00</span>
        <span className={overrun ? 'text-[var(--red)] font-semibold' : ''}>
          {overrun ? `${formatHM(liveAirborne - historicalAverageSeconds)} past avg` : 'flight in progress'}
        </span>
        <span className="num">{formatHM(Math.max(total, historicalAverageSeconds))}</span>
      </div>
    </div>
  )
}
