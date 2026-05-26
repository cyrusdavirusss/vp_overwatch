'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { StatusStrip } from '@/components/status-strip'
import { TimeScrubber } from '@/components/time-scrubber'
import { FabCluster } from '@/components/fab-cluster'
import { BottomSheet } from '@/components/bottom-sheet'
import { AircraftDetail } from '@/components/aircraft-detail'
import { ReportDetail } from '@/components/report-detail'
import { FilterPanel, type Filters } from '@/components/filter-panel'
import { DataGrid } from '@/components/data-grid'
import { useRealtimeData, sampleTrack } from '@/hooks/useRealtimeData'

const VPMap = dynamic(() => import('@/components/map').then((mod) => mod.VPMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[var(--map-bg)]">
      <div className="text-fg-3 text-sm font-mono tracking-[0.1em]">INITIALIZING MAP...</div>
    </div>
  ),
})

const STRIP_H = 36
const SCRUB_H = 64

export default function VPOverwatch() {
  const [isDesktop, setIsDesktop] = useState(false)
  const [screenDims, setScreenDims] = useState({ w: 393, h: 852 })

  useEffect(() => {
    function update() {
      const desktop = window.innerWidth >= 900
      setIsDesktop(desktop)
      setScreenDims({
        w: desktop ? window.innerWidth : window.innerWidth < 500 ? window.innerWidth : 393,
        h: desktop ? window.innerHeight : window.innerWidth < 500 ? window.innerHeight : 852,
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const liveData = useRealtimeData({
    aircraftInterval: 30_000,
    reportsInterval: 15_000,
    gpsInterval: 10_000,
    relayInterval: 3_000,
  })

  const [scrubT, setScrubT] = useState(0)
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('peek')
  const [filterOpen, setFilterOpen] = useState(false)
  const [followUser, setFollowUser] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [relayTick, setRelayTick] = useState(liveData.relay.lastTickAgo)
  const [systemClock, setSystemClock] = useState(Date.now())

  useEffect(() => { setRelayTick(liveData.relay.lastTickAgo) }, [liveData.relay.lastTickAgo])
  useEffect(() => {
    const id = setInterval(() => {
      setRelayTick((t) => t + 1)
      setSystemClock(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const [filters, setFilters] = useState<Filters>({
    aircraft: true,
    reports: true,
    trails: true,
    predictive: true,
    heatmap: false,
    rotary: true,
    fixedwing: true,
    kind_marked: true,
    kind_unmarked: true,
    kind_hidden: true,
    kind_stop: true,
    kind_checkpoint: true,
    kind_rbt: true,
    kind_camera: true,
    radius: 8,
    windowMin: 60,
  })

  const filteredAircraft = useMemo(() => {
    return liveData.aircraft.filter((a) => {
      if (!filters.aircraft) return false
      if (a.role === 'rotary' && !filters.rotary) return false
      if (a.role === 'fixedwing' && !filters.fixedwing) return false
      return true
    })
  }, [liveData.aircraft, filters])

  const filteredReports = useMemo(() => {
    return liveData.reports.filter((r) => {
      if (!filters.reports) return false
      if (r.kind === 'marked' && !filters.kind_marked) return false
      if (r.kind === 'unmarked' && !filters.kind_unmarked) return false
      if (r.kind === 'hidden' && !filters.kind_hidden) return false
      if (r.kind === 'stop' && !filters.kind_stop) return false
      if (r.kind === 'checkpoint' && !filters.kind_checkpoint) return false
      if (r.kind === 'rbt' && !filters.kind_rbt) return false
      if (r.kind === 'camera' && !filters.kind_camera) return false
      return true
    })
  }, [liveData.reports, filters])

  const onSelectAircraft = useCallback((id: string | null) => {
    setSelectedAircraftId(id)
    setSelectedReportId(null)
    if (id) {
      setSnap('half')
      const a = liveData.aircraft.find((x) => x.id === id)
      if (a) {
        const pos = sampleTrack(a.track, 0)
        if (pos) setFocusTarget({ lat: pos.lat, lng: pos.lng })
      }
    }
  }, [liveData.aircraft])

  const onSelectReport = useCallback((id: string | null) => {
    setSelectedReportId(id)
    setSelectedAircraftId(null)
    if (id) {
      setSnap('half')
      const r = liveData.reports.find((x) => x.id === id)
      if (r) setFocusTarget({ lat: r.lat, lng: r.lng })
    }
  }, [liveData.reports])

  const onCloseDetail = useCallback(() => {
    setSelectedAircraftId(null)
    setSelectedReportId(null)
    setSnap('peek')
  }, [])

  const onRecenter = useCallback(() => {
    setFollowUser(true)
    setFocusTarget({ lat: liveData.user.lat, lng: liveData.user.lng })
    setTimeout(() => setFollowUser(false), 100)
  }, [liveData.user])

  const selectedAircraft = filteredAircraft.find((a) => a.id === selectedAircraftId)
  const selectedReport = filteredReports.find((r) => r.id === selectedReportId)

  const detailContent = selectedAircraft ? (
    <AircraftDetail aircraft={selectedAircraft} user={liveData.user} scrubT={scrubT} onClose={onCloseDetail} />
  ) : selectedReport ? (
    <ReportDetail report={selectedReport} user={liveData.user} onClose={onCloseDetail} />
  ) : null

  const clockStr = useMemo(() => {
    const d = new Date(systemClock)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }, [systemClock])

  // ── Desktop: full Palantir multi-panel layout ──────────────────────────
  if (isDesktop) {
    const panelW = 380
    return (
      <div className="w-screen h-screen bg-ink-0 flex flex-col overflow-hidden" style={{ fontFamily: 'var(--font-ui)' }}>
        {/* Top command bar */}
        <div className="h-9 flex items-center justify-between px-3 bg-ink-1 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--blue)" strokeWidth="1.2" opacity="0.4" />
              <circle cx="12" cy="12" r="6.5" stroke="var(--blue)" strokeWidth="1.2" opacity="0.7" />
              <path d="M12 6 L16.5 14.5 L12 12.5 L7.5 14.5 Z" fill="var(--amber)" />
              <circle cx="12" cy="12" r="0.8" fill="var(--fg-1)" />
            </svg>
            <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-fg-1">VP-OVERWATCH</span>
            <span className="font-mono text-[9px] tracking-[0.08em] text-fg-4 uppercase">TACTICAL OPERATIONS CENTER</span>
          </div>

          <div className="flex items-center gap-4">
            {/* System metrics */}
            <div className="flex items-center gap-3">
              <StatusChip label="AIR" value={filteredAircraft.length} color="var(--amber)" />
              <StatusChip label="GND" value={filteredReports.length} color="var(--red)" />
              <StatusChip label="RELAY" value={relayTick < 120 ? 'LIVE' : 'STALE'} color={relayTick < 120 ? 'var(--green)' : 'var(--stale)'} />
            </div>

            <div className="w-px h-5 bg-border" />

            {/* Clock */}
            <div className="flex items-center gap-2">
              <span className="num text-[12px] font-semibold text-fg-1 tracking-[0.04em]">{clockStr}</span>
              <span className="font-mono text-[8px] text-fg-4 tracking-[0.1em]">AEST</span>
            </div>

            <div className="w-px h-5 bg-border" />

            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${liveData.relay.connected ? 'bg-[var(--green)]' : 'bg-[var(--red)]'}`} style={{ boxShadow: `0 0 6px ${liveData.relay.connected ? 'var(--green-glow)' : 'var(--red-glow)'}` }} />
              <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-fg-2 uppercase">
                {scrubT > 0 ? 'PLAYBACK' : liveData.relay.connected ? 'CONNECTED' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Map area (fills remaining space) */}
          <div className="flex-1 relative">
            <VPMap
              aircraft={filteredAircraft}
              reports={filteredReports}
              user={liveData.user}
              selectedAircraftId={selectedAircraftId}
              selectedReportId={selectedReportId}
              onSelectAircraft={onSelectAircraft}
              onSelectReport={onSelectReport}
              scrubT={scrubT}
              layers={{
                aircraft: filters.aircraft,
                reports: filters.reports,
                trails: filters.trails,
                predictive: filters.predictive,
              }}
              focusTarget={focusTarget}
            />

            {/* Map overlay: coordinates + zoom level */}
            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 px-2 py-1 rounded bg-ink-0/80 border border-border-subtle" style={{ backdropFilter: 'blur(8px)' }}>
              <span className="num text-[9px] text-fg-3">
                {liveData.user.lat.toFixed(4)}°, {liveData.user.lng.toFixed(4)}°
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="num text-[9px] text-fg-3">HDG {String(Math.round(liveData.user.hdg)).padStart(3, '0')}°</span>
            </div>

            {/* FAB Cluster */}
            <FabCluster
              onLayers={() => setFilterOpen((v) => !v)}
              onFilters={() => setFilterOpen((v) => !v)}
              onRecenter={onRecenter}
              followUser={followUser}
            />

            {/* Filter Panel Overlay */}
            {filterOpen && (
              <div
                className="absolute inset-0 z-40 flex items-center justify-center"
                style={{
                  background: 'color-mix(in srgb, var(--ink-0) 60%, transparent)',
                  backdropFilter: 'blur(4px)',
                }}
                onClick={(e) => e.target === e.currentTarget && setFilterOpen(false)}
              >
                <FilterPanel
                  filters={filters}
                  onFilterChange={setFilters}
                  onClose={() => setFilterOpen(false)}
                />
              </div>
            )}

            {/* Desktop time scrubber docked at bottom of map */}
            <div className="absolute left-0 right-0 bottom-0 z-20">
              <TimeScrubber
                aircraft={liveData.aircraft}
                reports={liveData.reports}
                value={scrubT}
                onChange={setScrubT}
              />
            </div>
          </div>

          {/* Right panel: data grid + detail */}
          <div className="flex flex-col" style={{ width: panelW }}>
            {/* Data grid (upper portion) */}
            <div className={detailContent ? 'h-[45%]' : 'flex-1'}>
              <DataGrid
                aircraft={filteredAircraft}
                reports={filteredReports}
                user={liveData.user}
                scrubT={scrubT}
                selectedAircraftId={selectedAircraftId}
                selectedReportId={selectedReportId}
                onSelectAircraft={onSelectAircraft}
                onSelectReport={onSelectReport}
              />
            </div>

            {/* Detail panel (lower portion) */}
            {detailContent && (
              <div className="flex-1 border-t border-border overflow-y-auto bg-ink-0">
                <div className="p-2">
                  {detailContent}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Mobile layout (original) ──────────────────────────────────────────
  const MOBILE_STRIP_H = 110
  const MOBILE_SCRUB_H = 96
  const MAP_H = screenDims.h - MOBILE_STRIP_H - MOBILE_SCRUB_H

  return (
    <div className="min-h-screen bg-ink-0 flex items-center justify-center">
      <div
        className="relative overflow-hidden bg-ink-0"
        style={{
          width: screenDims.w,
          height: screenDims.h,
          fontFamily: 'var(--font-ui)',
        }}
      >
        <StatusStrip
          aircraftCount={filteredAircraft.length}
          reportsCount={filteredReports.length}
          scrubT={scrubT}
          relay={{ ...liveData.relay, lastTickAgo: relayTick }}
        />

        <div
          className="absolute left-0 right-0"
          style={{ top: MOBILE_STRIP_H, height: MAP_H }}
        >
          <VPMap
            aircraft={filteredAircraft}
            reports={filteredReports}
            user={liveData.user}
            selectedAircraftId={selectedAircraftId}
            selectedReportId={selectedReportId}
            onSelectAircraft={onSelectAircraft}
            onSelectReport={onSelectReport}
            scrubT={scrubT}
            layers={{
              aircraft: filters.aircraft,
              reports: filters.reports,
              trails: filters.trails,
              predictive: filters.predictive,
            }}
            focusTarget={focusTarget}
          />

          <FabCluster
            onLayers={() => setFilterOpen((v) => !v)}
            onFilters={() => setFilterOpen((v) => !v)}
            onRecenter={onRecenter}
            followUser={followUser}
          />

          {filterOpen && (
            <div
              className="absolute inset-0 z-40 flex items-end pb-4"
              style={{
                background: 'color-mix(in srgb, var(--ink-0) 60%, transparent)',
                backdropFilter: 'blur(4px)',
              }}
              onClick={(e) => e.target === e.currentTarget && setFilterOpen(false)}
            >
              <FilterPanel
                filters={filters}
                onFilterChange={setFilters}
                onClose={() => setFilterOpen(false)}
              />
            </div>
          )}

          {!filterOpen && (
            <BottomSheet
              aircraft={filteredAircraft}
              reports={filteredReports}
              user={liveData.user}
              scrubT={scrubT}
              selectedAircraftId={selectedAircraftId}
              selectedReportId={selectedReportId}
              onSelectAircraft={onSelectAircraft}
              onSelectReport={onSelectReport}
              snap={snap}
              onSnapChange={setSnap}
              containerHeight={MAP_H}
              detailContent={detailContent}
            />
          )}
        </div>

        <div
          className="absolute left-0 right-0 bottom-0"
          style={{ height: MOBILE_SCRUB_H }}
        >
          <TimeScrubber
            aircraft={liveData.aircraft}
            reports={liveData.reports}
            value={scrubT}
            onChange={setScrubT}
          />
        </div>
      </div>
    </div>
  )
}

function StatusChip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[8px] font-semibold tracking-[0.12em] text-fg-4 uppercase">{label}</span>
      <span className="num text-[11px] font-bold" style={{ color }}>{typeof value === 'number' ? String(value).padStart(2, '0') : value}</span>
    </div>
  )
}
