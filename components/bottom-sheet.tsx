'use client'

import { useRef, useState, useMemo } from 'react'
import { Icon } from './icon'
import {
  Aircraft,
  Report,
  sampleTrack,
  computeDistance,
  computeBearing,
  compassFromBearing,
  formatSec,
  formatHM,
  USER,
} from '@/lib/data'

interface BottomSheetProps {
  aircraft: Aircraft[]
  reports: Report[]
  scrubT: number
  selectedAircraftId: string | null
  selectedReportId: string | null
  onSelectAircraft: (id: string) => void
  onSelectReport: (id: string) => void
  snap: 'peek' | 'half' | 'full'
  onSnapChange: (snap: 'peek' | 'half' | 'full') => void
  containerHeight: number
  detailContent?: React.ReactNode
}

export function BottomSheet({
  aircraft,
  reports,
  scrubT,
  selectedAircraftId,
  selectedReportId,
  onSelectAircraft,
  onSelectReport,
  snap,
  onSnapChange,
  containerHeight,
  detailContent,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  const snaps = useMemo(
    () => ({
      peek: 88,
      half: Math.round(containerHeight * 0.46),
      full: Math.round(containerHeight * 0.86),
    }),
    [containerHeight]
  )

  const heightFor = (s: 'peek' | 'half' | 'full') => snaps[s]

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.vp-feed-item')) return
    dragRef.current = { startY: e.clientY, startHeight: heightFor(snap) }
    sheetRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dy = dragRef.current.startY - e.clientY
    setDragOffset(dy)
  }

  const onPointerUp = () => {
    if (!dragRef.current) return
    const currentH = dragRef.current.startHeight + dragOffset
    // Snap to nearest
    const snapPoints = ['peek', 'half', 'full'] as const
    const nearest = snapPoints.sort(
      (a, b) => Math.abs(snaps[a] - currentH) - Math.abs(snaps[b] - currentH)
    )[0]
    onSnapChange(nearest)
    setDragOffset(0)
    dragRef.current = null
  }

  const currentHeight = heightFor(snap) + dragOffset

  // Build feed: aircraft first, then reports by recency
  const feed = useMemo(() => {
    const items: Array<
      | { kind: 'aircraft'; obj: Aircraft; pos: NonNullable<ReturnType<typeof sampleTrack>> }
      | { kind: 'report'; obj: Report; ageAtScrub: number }
    > = []

    aircraft.forEach((a) => {
      const pos = sampleTrack(a.track, scrubT)
      if (pos) items.push({ kind: 'aircraft', obj: a, pos })
    })

    reports.forEach((r) => {
      const reportAgeAtScrub = r.reportedAgo - scrubT
      if (reportAgeAtScrub >= 0) {
        items.push({ kind: 'report', obj: r, ageAtScrub: reportAgeAtScrub })
      }
    })

    return items
  }, [aircraft, reports, scrubT])

  return (
    <div
      ref={sheetRef}
      className="absolute left-0 right-0 bottom-0 z-30 flex flex-col overflow-hidden bg-ink-1 touch-none"
      style={{
        height: `${currentHeight}px`,
        borderTopLeftRadius: 'var(--r-lg)',
        borderTopRightRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-sheet)',
        transition: dragRef.current ? 'none' : 'height var(--dur-panel) var(--ease-spring)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Handle */}
      <div className="py-2 flex items-center justify-center cursor-grab">
        <div className="w-9 h-1 bg-ink-4 rounded-full" />
      </div>

      {/* Header - only shown when no detail content */}
      {!detailContent && (
        <div className="px-4 pb-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold tracking-[0.04em] uppercase text-fg-2">
              Active
            </span>
            <span className="num text-base font-semibold text-fg-1">{feed.length}</span>
          </div>
          <div className="flex gap-0.5 p-0.5 bg-ink-2 rounded-full border border-border">
            {['All', 'Air', 'Ground'].map((tab) => (
              <button
                key={tab}
                className={`h-[22px] px-2.5 rounded-full font-mono text-[10px] font-semibold tracking-[0.06em] uppercase transition-colors ${
                  tab === 'All' ? 'bg-ink-3 text-fg-1' : 'text-fg-3 hover:text-fg-1'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 pb-20">
        {detailContent ||
          feed.map((item) =>
            item.kind === 'aircraft' ? (
              <AircraftFeedItem
                key={item.obj.id}
                aircraft={item.obj}
                pos={item.pos}
                selected={item.obj.id === selectedAircraftId}
                onClick={() => onSelectAircraft(item.obj.id)}
              />
            ) : (
              <ReportFeedItem
                key={item.obj.id}
                report={item.obj}
                ageAtScrub={item.ageAtScrub}
                selected={item.obj.id === selectedReportId}
                onClick={() => onSelectReport(item.obj.id)}
              />
            )
          )}
      </div>
    </div>
  )
}

interface AircraftFeedItemProps {
  aircraft: Aircraft
  pos: NonNullable<ReturnType<typeof sampleTrack>>
  selected: boolean
  onClick: () => void
}

function AircraftFeedItem({ aircraft, pos, selected, onClick }: AircraftFeedItemProps) {
  const distNm = computeDistance(USER.lat, USER.lng, pos.lat, pos.lng) / 1852
  const bearing = computeBearing(USER.lat, USER.lng, pos.lat, pos.lng)
  const trend = pos.vs > 50 ? 'up' : pos.vs < -50 ? 'dn' : null

  const airborneSec = aircraft.timeAirborneSeconds || 0
  const returnSec = aircraft.estimatedReturnSeconds || 0
  const histSec = aircraft.historicalAverageSeconds || 1
  const total = airborneSec + returnSec
  const pct = Math.min(1, airborneSec / Math.max(total, 1))
  const overrun = airborneSec > histSec

  return (
    <div
      className={`vp-feed-item flex items-center gap-3 py-3 px-2 border-b border-border-subtle cursor-pointer rounded transition-colors ${
        selected ? 'bg-[color-mix(in_srgb,var(--blue)_8%,var(--ink-2))]' : 'hover:bg-ink-2'
      }`}
      onClick={onClick}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center bg-[var(--amber-wash)] border border-[color-mix(in_srgb,var(--amber)_30%,var(--border))] text-[var(--amber)]">
        <Icon name={aircraft.role === 'rotary' ? 'helicopter' : 'plane'} size={18} strokeWidth={1.6} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg-1 tracking-[0.04em]">
            {aircraft.registration}
          </span>
          {aircraft.callsign && (
            <span className="font-mono text-[11px] text-[var(--amber)] tracking-[0.04em]">
              {aircraft.callsign}
            </span>
          )}
          <span className="text-[11px] text-fg-3">· {aircraft.type}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg-2 whitespace-nowrap overflow-hidden text-ellipsis tabular-nums">
          <span>{pos.alt.toLocaleString()}ft</span>
          {trend && (
            <span className={trend === 'up' ? 'text-[var(--green)]' : 'text-[var(--amber)]'}>
              {trend === 'up' ? '↑' : '↓'}
            </span>
          )}
          <span className="text-fg-4">·</span>
          <span>{pos.spd.toFixed(0)}kts</span>
          <span className="text-fg-4">·</span>
          <span>{String(pos.hdg).padStart(3, '0')}°</span>
        </div>

        {/* Airborne progress strip */}
        <div className="flex items-center gap-2 mt-1.5">
          <div className="relative flex-1 h-[3px] bg-ink-3 rounded-full overflow-hidden">
            <div
              className="absolute top-0 left-0 bottom-0 bg-[var(--amber)] rounded-full"
              style={{ width: `${pct * 100}%` }}
            />
            <div
              className="absolute top-[-1px] bottom-[-1px] w-px bg-fg-2/60"
              style={{
                left: `${(histSec / Math.max(total, histSec)) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            />
            {overrun && (
              <div
                className="absolute inset-0 opacity-50"
                style={{
                  background: 'repeating-linear-gradient(-45deg, var(--red) 0 3px, transparent 3px 6px)',
                }}
              />
            )}
          </div>
          <div className="flex gap-2 num text-[9px] text-fg-3 whitespace-nowrap">
            <span>{formatSec(airborneSec)}</span>
            <span className={overrun ? 'text-[var(--red)]' : ''}>
              {overrun ? 'past avg' : `−${formatSec(returnSec)}`}
            </span>
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="flex-shrink-0 text-right">
        <div className="num text-xs font-medium text-fg-1 tracking-[0.02em]">
          {distNm.toFixed(1)}nm
        </div>
        <div className="font-mono text-[9.5px] text-fg-3 tracking-[0.04em]">
          {compassFromBearing(bearing)}
        </div>
      </div>
    </div>
  )
}

interface ReportFeedItemProps {
  report: Report
  ageAtScrub: number
  selected: boolean
  onClick: () => void
}

function ReportFeedItem({ report, selected, onClick }: ReportFeedItemProps) {
  const distMi = computeDistance(USER.lat, USER.lng, report.lat, report.lng) / 1609
  const bearing = computeBearing(USER.lat, USER.lng, report.lat, report.lng)

  const labelForKind = (kind: Report['kind']): string => {
    switch (kind) {
      case 'marked': return 'Marked unit'
      case 'unmarked': return 'Unmarked unit'
      case 'hidden': return 'Hidden unit'
      case 'stop': return 'Roadside stop'
      case 'checkpoint': return 'Checkpoint'
      case 'rbt': return 'RBT checkpoint'
      case 'camera': return 'Speed camera'
      default: return 'Ground report'
    }
  }

  const iconForKind = (kind: Report['kind']): string => {
    switch (kind) {
      case 'marked':
      case 'unmarked':
        return 'car'
      case 'hidden':
      case 'camera':
        return 'eye'
      default:
        return 'alert'
    }
  }

  return (
    <div
      className={`vp-feed-item flex items-center gap-3 py-3 px-2 border-b border-border-subtle cursor-pointer rounded transition-colors ${
        selected ? 'bg-[color-mix(in_srgb,var(--blue)_8%,var(--ink-2))]' : 'hover:bg-ink-2'
      }`}
      onClick={onClick}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center bg-[var(--red-wash)] border border-[color-mix(in_srgb,var(--red)_30%,var(--border))] text-[var(--red)]">
        <Icon name={iconForKind(report.kind)} size={16} strokeWidth={1.6} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-fg-1">
            {labelForKind(report.kind)}
          </span>
          <span
            className={`chip text-[9px] ${
              report.nThumbsUp >= 5 ? 'chip-confirm' : 'chip-stale'
            }`}
          >
            {report.nThumbsUp >= 5
              ? `${report.nThumbsUp}× CONFIRMED`
              : `${report.nThumbsUp} report${report.nThumbsUp > 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="text-[11px] text-fg-2 truncate">{report.descr}</div>
      </div>

      {/* Meta */}
      <div className="flex-shrink-0 text-right">
        <div className="num text-xs font-medium text-fg-1 tracking-[0.02em]">
          {distMi.toFixed(1)}mi
        </div>
        <div className="font-mono text-[9.5px] text-fg-3 tracking-[0.04em]">
          {compassFromBearing(bearing)} · {formatSec(report.lastConfirmedAgo)}
        </div>
      </div>
    </div>
  )
}
