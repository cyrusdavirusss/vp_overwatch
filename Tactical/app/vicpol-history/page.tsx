'use client'

import { useEffect, useState } from 'react'
import type { SortieEntry } from '@/lib/store'

export default function VicPolHistoryPage() {
  const [sorties, setSorties] = useState<SortieEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/vicpol/history')
      .then((r) => r.json())
      .then((data: SortieEntry[]) => {
        setSorties(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div
      className="min-h-screen bg-ink-0 flex flex-col"
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      {/* Header */}
      <div className="h-9 flex items-center justify-between px-3 bg-ink-1 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="w-7 h-7 flex items-center justify-center bg-ink-2 border border-border text-fg-2 rounded-md hover:bg-ink-3 hover:text-fg-1 transition-colors"
            aria-label="Back to map"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </a>
          <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-fg-1">
            SORTIE HISTORY
          </span>
          <span className="font-mono text-[9px] tracking-[0.08em] text-fg-4 uppercase">
            VICPOL AIR WING
          </span>
        </div>
        <div className="num text-[12px] font-semibold text-fg-3 tracking-[0.04em]">
          {sorties.length} sorties
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-fg-3 text-sm font-mono tracking-[0.1em]">
            LOADING HISTORY...
          </div>
        ) : sorties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-fg-3 text-sm font-mono tracking-[0.1em]">NO SORTIES RECORDED</span>
            <span className="text-fg-4 text-xs font-mono">Sortie data appears here as aircraft are detected</span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-ink-1 border-b border-border">
                <Th>DATE/TIME</Th>
                <Th>CALLSIGN</Th>
                <Th>TYPE</Th>
                <Th>DURATION</Th>
                <Th>MAX ALT</Th>
                <Th>STATUS</Th>
              </tr>
            </thead>
            <tbody>
              {sorties.map((s) => {
                const dt = new Date(s.startTime)
                const dateStr = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`
                const timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`
                const durStr = s.status === 'active' ? '—' : formatDuration(s.durationSeconds)
                const altStr = s.maxAltitude > 0 ? `${s.maxAltitude.toLocaleString()}ft` : '—'
                const isActive = s.status === 'active'
                return (
                  <tr
                    key={s.id}
                    className={`border-b border-border-subtle transition-colors hover:bg-ink-1`}
                  >
                    <Td>
                      <div className="flex flex-col leading-tight">
                        <span className="num text-fg-1 text-[11px]">{dateStr}</span>
                        <span className="num text-fg-3 text-[9px]">{timeStr}</span>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-fg-1 font-semibold">{s.callsign || s.hex}</span>
                    </Td>
                    <Td mono className="text-fg-2">{s.type}</Td>
                    <Td mono className="text-fg-1">{durStr}</Td>
                    <Td mono className="text-fg-2">{altStr}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{
                            background: isActive ? 'var(--green)' : 'var(--amber)',
                            boxShadow: isActive ? '0 0 6px var(--green-glow)' : 'none',
                            opacity: isActive ? 1 : 0.5,
                          }}
                        />
                        <span
                          className="font-mono text-[9px] font-semibold tracking-[0.12em] uppercase"
                          style={{
                            color: isActive ? 'var(--green)' : 'var(--amber)',
                            opacity: isActive ? 1 : 0.6,
                          }}
                        >
                          {isActive ? 'ACTIVE' : 'LANDED'}
                        </span>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-mono text-[8px] font-semibold tracking-[0.12em] text-fg-3 uppercase whitespace-nowrap bg-ink-1">
      {children}
    </th>
  )
}

function Td({ children, mono, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-2 text-[11px] whitespace-nowrap ${mono ? 'font-mono tabular-nums' : ''} ${className || 'text-fg-1'}`}>
      {children}
    </td>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const mins = m % 60
  return `${h}h${String(mins).padStart(2, '0')}m`
}
