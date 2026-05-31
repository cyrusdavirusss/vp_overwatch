'use client'

import { Icon } from './icon'
import { Dot } from './ui'
import { formatSec, Relay } from '@/lib/data'

interface StatusStripProps {
  aircraftCount: number
  reportsCount: number
  scrubT: number
  relay: Relay
  onThemeToggle?: () => void
  silentCount?: number
}

export function StatusStrip({
  aircraftCount,
  reportsCount,
  scrubT,
  relay,
  onThemeToggle,
  silentCount = 0,
}: StatusStripProps) {
  const scrubbed = scrubT > 0

  return (
    <div className="absolute top-0 left-0 right-0 z-10 pt-[54px] px-3.5 pb-2">
      <div
        className="flex items-center justify-between"
        style={{
          background: 'color-mix(in srgb, var(--ink-1) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
          borderRadius: 'var(--r-md)',
          padding: '8px 12px',
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* Logo mark */}
          <div className="w-8 h-8 flex items-center justify-center bg-ink-2 border border-border rounded-md">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="var(--blue)"
                strokeWidth="1.2"
                opacity="0.4"
              />
              <circle
                cx="12"
                cy="12"
                r="6.5"
                stroke="var(--blue)"
                strokeWidth="1.2"
                opacity="0.7"
              />
              <path
                d="M12 6 L16.5 14.5 L12 12.5 L7.5 14.5 Z"
                fill="var(--amber)"
              />
              <circle cx="12" cy="12" r="0.8" fill="var(--fg-1)" />
            </svg>
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-fg-1 leading-none">
              VP-OVERWATCH
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[9.5px] font-medium tracking-[0.06em] text-fg-3">
              <Dot
                pulse
                className={
                  relay.connected
                    ? 'text-[var(--blue)]'
                    : 'text-[var(--red)]'
                }
              />
              <span className="tracking-[0.1em] uppercase">
                {scrubbed ? 'PLAYBACK' : relay.connected ? 'LIVE' : 'OFFLINE'}
              </span>
              <span className="num">
                {scrubbed ? `−${formatSec(scrubT)}` : `${relay.lastTickAgo}s`}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Stat n={aircraftCount} label="airborne" tone="amber" />
          <Stat n={reportsCount} label="ground" tone="red" />
          {silentCount !== undefined && silentCount > 0 && (
            <div className="flex items-center gap-1 px-1">
              <span className="num text-base font-semibold leading-none" style={{ color: 'var(--amber)' }}>
                {silentCount}
              </span>
              <span className="font-mono text-[9.5px] tracking-[0.08em] uppercase text-fg-3 leading-none">
                SILENT
              </span>
            </div>
          )}
          <a
            href="/vicpol-history"
            className="w-7 h-7 ml-1 flex items-center justify-center bg-ink-2 border border-border text-fg-2 rounded-md hover:bg-ink-3 hover:text-fg-1 transition-colors"
            aria-label="Sortie history"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </a>
          <button
            className="w-8 h-8 ml-0.5 flex items-center justify-center bg-ink-2 border border-border text-fg-2 rounded-md hover:bg-ink-3 hover:text-fg-1 transition-colors"
            onClick={onThemeToggle}
            aria-label="Toggle theme"
          >
            <Icon name="sun" size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number
  label: string
  tone: 'amber' | 'red' | 'blue'
}) {
  const colors = {
    amber: 'text-[var(--amber)]',
    red: 'text-[var(--red)]',
    blue: 'text-[var(--blue)]',
  }

  return (
    <div className="flex items-baseline gap-1 px-1">
      <div className={`num text-base font-semibold leading-none ${colors[tone]}`}>
        {String(n).padStart(2, '0')}
      </div>
      <div className="font-mono text-[9.5px] tracking-[0.08em] uppercase text-fg-3 leading-none">
        {label}
      </div>
    </div>
  )
}
