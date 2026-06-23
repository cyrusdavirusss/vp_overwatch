'use client'

/**
 * RouteAlertPanel — "Paranoid" route threat summary
 *
 * Shows the fused headline ("POL31 is orbiting 2km NE and there is a
 * confirmed hidden unit on your route") plus a ranked list of all threats
 * within the route corridor.
 *
 * Requires the user to have set a route via the map's pick-mode or by
 * providing a destination.
 */

import { useState } from 'react'
import type { RouteAlertResult, RouteAlert } from '@/lib/route-alerts'
import type { Aircraft, Report } from '@/lib/store'

interface RouteAlertPanelProps {
  result: RouteAlertResult
  onSelectAircraft?: (aircraft: Aircraft) => void
  onSelectReport?: (report: Report) => void
}

const THREAT_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: 'color-mix(in srgb, var(--red) 12%, transparent)', border: 'color-mix(in srgb, var(--red) 35%, transparent)', text: 'var(--red)', dot: 'var(--red)' },
  high:     { bg: 'color-mix(in srgb, #f97316 12%, transparent)', border: 'color-mix(in srgb, #f97316 35%, transparent)', text: '#f97316', dot: '#f97316' },
  medium:   { bg: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: 'color-mix(in srgb, var(--amber) 30%, transparent)', text: 'var(--amber)', dot: 'var(--amber)' },
  low:      { bg: 'color-mix(in srgb, var(--ink-3) 60%, transparent)', border: 'var(--border)', text: 'var(--fg-3)', dot: 'var(--fg-4)' },
}

function ThreatDot({ level, pulse }: { level: string; pulse?: boolean }) {
  const c = THREAT_COLORS[level] ?? THREAT_COLORS.low
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: c.dot }}
    />
  )
}

function AlertRow({ alert, onSelect }: { alert: RouteAlert; onSelect: () => void }) {
  const c = THREAT_COLORS[alert.threat] ?? THREAT_COLORS.low
  const isAircraft = alert.kind === 'aircraft'

  return (
    <button
      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-md text-left transition-opacity hover:opacity-80 active:opacity-60"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
      onClick={onSelect}
    >
      <ThreatDot level={alert.threat} pulse={alert.threat === 'critical'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 mb-0.5">
          <span className="font-mono text-[11px] font-bold tracking-wide" style={{ color: c.text }}>
            {alert.threat.toUpperCase()}
          </span>
          <span className="text-[10px] text-fg-3">
            {isAircraft ? '✈' : '🚔'} {alert.distKm}km {alert.compassDir}
          </span>
        </div>
        <p className="text-[11px] text-fg-2 leading-snug">{alert.summary}</p>
      </div>
    </button>
  )
}

export function RouteAlertPanel({ result, onSelectAircraft, onSelectReport }: RouteAlertPanelProps) {
  const [expanded, setExpanded] = useState(false)

  if (result.alerts.length === 0) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]"
        style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)', color: 'var(--green)' }}
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--green)' }} />
        <span>Route clear — no units detected in corridor</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Headline */}
      {result.headline && (
        <div
          className="px-3 py-2.5 rounded-lg cursor-pointer"
          style={{
            background: result.hasCritical
              ? 'color-mix(in srgb, var(--red) 15%, var(--ink-1))'
              : 'color-mix(in srgb, var(--amber) 12%, var(--ink-1))',
            border: `1px solid ${result.hasCritical ? 'color-mix(in srgb, var(--red) 40%, transparent)' : 'color-mix(in srgb, var(--amber) 35%, transparent)'}`,
          }}
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-2 mb-1">
            <ThreatDot level={result.hasCritical ? 'critical' : 'high'} pulse />
            <span
              className="font-mono text-[10px] font-bold tracking-[0.1em] uppercase"
              style={{ color: result.hasCritical ? 'var(--red)' : 'var(--amber)' }}
            >
              {result.hasCritical ? 'ROUTE THREAT' : 'ROUTE ADVISORY'}
            </span>
            <span className="ml-auto text-[10px] text-fg-3">
              {result.alerts.length} unit{result.alerts.length > 1 ? 's' : ''} · {expanded ? 'hide' : 'show all'}
            </span>
          </div>
          <p className="text-[12px] text-fg-1 leading-snug font-medium">
            {result.headline}
          </p>
        </div>
      )}

      {/* Expanded alert list */}
      {expanded && (
        <div className="flex flex-col gap-1">
          {result.alerts.map((alert, i) => (
            <AlertRow
              key={i}
              alert={alert}
              onSelect={() => {
                if (alert.kind === 'aircraft') onSelectAircraft?.(alert.aircraft)
                else onSelectReport?.(alert.report)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
