'use client'

import { Icon } from './icon'
import { Metric, Chip, Dot } from './ui'
import {
  Report,
  User,
  computeDistance,
  computeBearing,
  compassFromBearing,
  formatSec,
} from '@/lib/data'

interface ReportDetailProps {
  report: Report
  user: User
  onClose: () => void
}

export function ReportDetail({ report, user, onClose }: ReportDetailProps) {
  const distMi = computeDistance(user.lat, user.lng, report.lat, report.lng) / 1609
  const bearing = computeBearing(user.lat, user.lng, report.lat, report.lng)
  const confirmed = report.nThumbsUp >= 5 && report.lastConfirmedAgo < 120
  const decay = Math.max(0, Math.min(1, 1 - report.lastConfirmedAgo / 600))

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

  return (
    <div className="bg-ink-1 border border-border rounded-lg p-4 mx-3">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-col gap-0.5">
          <div className="text-xl font-semibold text-fg-1 tracking-[-0.012em] leading-none">
            {labelForKind(report.kind)}
          </div>
          <div className="text-xs text-fg-3">
            {report.street}, {report.city}
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

      {/* Status row */}
      <div className="flex items-center justify-between mb-3.5">
        {confirmed ? (
          <Chip variant="confirm" className="gap-1.5">
            <Dot pulse className="text-[var(--green)]" />
            {report.nThumbsUp}× CONFIRMED
          </Chip>
        ) : (
          <Chip variant="stale">
            {report.nThumbsUp} report{report.nThumbsUp !== 1 ? 's' : ''}
          </Chip>
        )}
        <span className="num text-[11px] text-fg-3">
          last {formatSec(report.lastConfirmedAgo)} ago
        </span>
      </div>

      {/* Quality bars */}
      <div className="flex flex-col gap-2 bg-ink-2 border border-border rounded-md p-3 mb-3.5">
        <QualityBar label="reliability" value={report.reliability} max={10} />
        <QualityBar label="confidence" value={report.confidence} max={10} />
        <QualityBar
          label="freshness"
          value={Math.round(decay * 10)}
          max={10}
          color="var(--green)"
        />
      </div>

      {/* Metrics grid */}
      <div
        className="grid grid-cols-3 gap-px rounded-md overflow-hidden mb-3"
        style={{ background: 'var(--border-subtle)' }}
      >
        <Metric label="distance" value={distMi.toFixed(1)} unit="mi" />
        <Metric
          label="bearing"
          value={String(Math.round(bearing)).padStart(3, '0')}
          unit={`° ${compassFromBearing(bearing)}`}
        />
        <Metric label="reported" value={formatSec(report.reportedAgo)} unit="ago" />
      </div>

      {/* Source */}
      <div className="flex items-center justify-between pt-2.5 mt-3 border-t border-border-subtle text-[11px]">
        <span className="t-label">Source</span>
        <span className="num text-fg-3">Waze · {report.wazeUuid}</span>
      </div>
    </div>
  )
}

function QualityBar({
  label,
  value,
  max,
  color = 'var(--blue)',
}: {
  label: string
  value: number
  max: number
  color?: string
}) {
  const pct = Math.max(0, Math.min(1, value / max))

  return (
    <div className="grid grid-cols-[80px_1fr_36px] items-center gap-2.5">
      <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3">
        {label}
      </div>
      <div className="h-1 bg-ink-3 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct * 100}%`, background: color }}
        />
      </div>
      <div className="num text-[10px] text-fg-2 text-right">
        {value}/{max}
      </div>
    </div>
  )
}
