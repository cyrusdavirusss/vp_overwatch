'use client'

import { useState, useMemo } from 'react'
import { Icon } from './icon'
import {
  Aircraft,
  Report,
  User,
  sampleTrack,
  computeDistance,
  computeBearing,
  compassFromBearing,
  formatSec,
} from '@/lib/data'

type SortKey = 'id' | 'alt' | 'spd' | 'dist' | 'hdg' | 'time' | 'kind' | 'age' | 'conf'
type SortDir = 'asc' | 'desc'

interface DataGridProps {
  aircraft: Aircraft[]
  reports: Report[]
  user: User
  scrubT: number
  selectedAircraftId: string | null
  selectedReportId: string | null
  onSelectAircraft: (id: string) => void
  onSelectReport: (id: string) => void
}

export function DataGrid({
  aircraft,
  reports,
  user,
  scrubT,
  selectedAircraftId,
  selectedReportId,
  onSelectAircraft,
  onSelectReport,
}: DataGridProps) {
  const [tab, setTab] = useState<'aircraft' | 'ground'>('aircraft')
  const [sortKey, setSortKey] = useState<SortKey>('dist')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''

  const aircraftRows = useMemo(() => {
    return aircraft.map(a => {
      const pos = sampleTrack(a.track, scrubT)
      const dist = pos ? computeDistance(user.lat, user.lng, pos.lat, pos.lng) / 1852 : 999
      const brg = pos ? computeBearing(user.lat, user.lng, pos.lat, pos.lng) : 0
      return { a, pos, dist, brg }
    }).sort((a, b) => {
      let va: number, vb: number
      switch (sortKey) {
        case 'alt': va = a.pos?.alt ?? 0; vb = b.pos?.alt ?? 0; break
        case 'spd': va = a.pos?.spd ?? 0; vb = b.pos?.spd ?? 0; break
        case 'dist': va = a.dist; vb = b.dist; break
        case 'hdg': va = a.pos?.hdg ?? 0; vb = b.pos?.hdg ?? 0; break
        case 'time': va = a.a.timeAirborneSeconds; vb = b.a.timeAirborneSeconds; break
        default: va = a.dist; vb = b.dist
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [aircraft, scrubT, user, sortKey, sortDir])

  const reportRows = useMemo(() => {
    return reports.map(r => {
      const dist = computeDistance(user.lat, user.lng, r.lat, r.lng) / 1609
      const brg = computeBearing(user.lat, user.lng, r.lat, r.lng)
      return { r, dist, brg }
    }).sort((a, b) => {
      let va: number, vb: number
      switch (sortKey) {
        case 'dist': va = a.dist; vb = b.dist; break
        case 'age': va = a.r.reportedAgo; vb = b.r.reportedAgo; break
        case 'conf': va = a.r.nThumbsUp; vb = b.r.nThumbsUp; break
        default: va = a.dist; vb = b.dist
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [reports, user, sortKey, sortDir])

  return (
    <div className="flex flex-col h-full bg-ink-0 border-l border-border">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-ink-1">
        <TabBtn active={tab === 'aircraft'} onClick={() => { setTab('aircraft'); setSortKey('dist') }}>
          <span className="text-[var(--amber)]">AIR</span>
          <span className="num text-[10px] ml-1 text-fg-3">{aircraft.length}</span>
        </TabBtn>
        <TabBtn active={tab === 'ground'} onClick={() => { setTab('ground'); setSortKey('dist') }}>
          <span className="text-[var(--red)]">GND</span>
          <span className="num text-[10px] ml-1 text-fg-3">{reports.length}</span>
        </TabBtn>
        <div className="flex-1" />
        <div className="px-2 font-mono text-[8px] text-fg-4 tracking-[0.12em] uppercase">
          SORTABLE GRID
        </div>
      </div>

      {tab === 'aircraft' ? (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-ink-1 border-b border-border">
                <Th onClick={() => toggleSort('id')}>IDENT {sortIcon('id')}</Th>
                <Th onClick={() => toggleSort('alt')}>ALT {sortIcon('alt')}</Th>
                <Th onClick={() => toggleSort('spd')}>SPD {sortIcon('spd')}</Th>
                <Th onClick={() => toggleSort('hdg')}>HDG {sortIcon('hdg')}</Th>
                <Th onClick={() => toggleSort('dist')}>DIST {sortIcon('dist')}</Th>
                <Th onClick={() => toggleSort('time')}>AIRBORNE {sortIcon('time')}</Th>
                <Th>BRG</Th>
                <Th>V/S</Th>
              </tr>
            </thead>
            <tbody>
              {aircraftRows.map(({ a, pos, dist, brg }) => {
                if (!pos) return null
                const sel = a.id === selectedAircraftId
                return (
                  <tr
                    key={a.id}
                    className={`border-b border-border-subtle cursor-pointer transition-colors ${
                      sel ? 'bg-[rgba(77,124,255,0.08)]' : 'hover:bg-ink-1'
                    }`}
                    onClick={() => onSelectAircraft(a.id)}
                  >
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block flex-shrink-0" />
                        <span className="text-fg-1 font-semibold">{a.callsign || a.hex}</span>
                        <span className="text-fg-4 text-[9px]">{a.type}</span>
                      </div>
                    </Td>
                    <Td mono>{pos.alt.toLocaleString()}<span className="text-fg-4 ml-0.5">ft</span></Td>
                    <Td mono>{pos.spd.toFixed(0)}<span className="text-fg-4 ml-0.5">kts</span></Td>
                    <Td mono>{String(pos.hdg).padStart(3, '0')}°</Td>
                    <Td mono>{dist.toFixed(1)}<span className="text-fg-4 ml-0.5">nm</span></Td>
                    <Td mono>{formatSec(a.timeAirborneSeconds)}</Td>
                    <Td mono className="text-fg-3">{String(Math.round(brg)).padStart(3, '0')}° {compassFromBearing(brg)}</Td>
                    <Td mono className={pos.vs > 50 ? 'text-[var(--green)]' : pos.vs < -50 ? 'text-[var(--amber)]' : 'text-fg-3'}>
                      {pos.vs > 0 ? '+' : ''}{pos.vs}<span className="text-fg-4 ml-0.5">fpm</span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-ink-1 border-b border-border">
                <Th onClick={() => toggleSort('kind')}>TYPE {sortIcon('kind')}</Th>
                <Th>LOCATION</Th>
                <Th onClick={() => toggleSort('dist')}>DIST {sortIcon('dist')}</Th>
                <Th>BRG</Th>
                <Th onClick={() => toggleSort('age')}>AGE {sortIcon('age')}</Th>
                <Th onClick={() => toggleSort('conf')}>CONF {sortIcon('conf')}</Th>
                <Th>REL</Th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map(({ r, dist, brg }) => {
                const sel = r.id === selectedReportId
                const kindLabels: Record<string, string> = {
                  marked: 'MARKED', unmarked: 'UNMARKED', hidden: 'HIDDEN',
                  stop: 'STOP', checkpoint: 'CHKPT', rbt: 'RBT', camera: 'CAM',
                }
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-border-subtle cursor-pointer transition-colors ${
                      sel ? 'bg-[rgba(77,124,255,0.08)]' : 'hover:bg-ink-1'
                    }`}
                    onClick={() => onSelectReport(r.id)}
                  >
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${
                          r.nThumbsUp >= 5 ? 'bg-[var(--green)]' : 'bg-[var(--red)]'
                        }`} />
                        <span className="text-fg-1 font-semibold">{kindLabels[r.kind] || r.kind.toUpperCase()}</span>
                      </div>
                    </Td>
                    <Td className="text-fg-2 max-w-[120px] truncate">{r.street}</Td>
                    <Td mono>{dist.toFixed(1)}<span className="text-fg-4 ml-0.5">mi</span></Td>
                    <Td mono className="text-fg-3">{String(Math.round(brg)).padStart(3, '0')}° {compassFromBearing(brg)}</Td>
                    <Td mono>{formatSec(r.reportedAgo)}</Td>
                    <Td mono className={r.nThumbsUp >= 5 ? 'text-[var(--green)]' : 'text-fg-3'}>{r.nThumbsUp}x</Td>
                    <Td mono>{r.reliability}/10</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`h-8 px-3 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors border-b-2 ${
        active ? 'border-[var(--blue)] text-fg-1 bg-ink-2' : 'border-transparent text-fg-3 hover:text-fg-1'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th
      className={`px-2 py-1.5 font-mono text-[8px] font-semibold tracking-[0.12em] text-fg-3 uppercase whitespace-nowrap bg-ink-1 ${
        onClick ? 'cursor-pointer hover:text-fg-1' : ''
      }`}
      onClick={onClick}
    >
      {children}
    </th>
  )
}

function Td({ children, mono, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <td className={`px-2 py-1.5 text-[11px] whitespace-nowrap ${mono ? 'font-mono tabular-nums' : ''} ${className || 'text-fg-1'}`}>
      {children}
    </td>
  )
}
