'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { StatusStrip } from '@/components/status-strip'
import { TimeScrubber } from '@/components/time-scrubber'
import { FabCluster } from '@/components/fab-cluster'
import { BottomSheet } from '@/components/bottom-sheet'
import { AircraftDetail } from '@/components/aircraft-detail'
import { ReportDetail } from '@/components/report-detail'
import { FilterPanel, type Filters } from '@/components/filter-panel'
import { LocationSetter } from '@/components/location-setter'
import { DataGrid } from '@/components/data-grid'
import { LazyMap } from '@/components/lazy-map'
import { useRealtimeData, sampleTrack } from '@/hooks/useRealtimeData'
import { useClientLocation } from '@/hooks/useClientLocation'
import type { User } from '@/lib/data'

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
    relayInterval: 3_000,
  })

  const clientLocation = useClientLocation()

  // Derive a User object from the client-held position
  // Never sent over the network — lives only in React state.
  const userPosition: User = useMemo(() => ({
    lat: clientLocation.position?.lat ?? -37.8136,
    lng: clientLocation.position?.lng ?? 144.9631,
    hdg: 0,
    accuracy: clientLocation.position?.accuracy ?? 5000,
  }), [clientLocation.position])

  const [scrubT, setScrubT] = useState(0)
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('peek')
  const [filterOpen, setFilterOpen] = useState(false)
  const [followUser, setFollowUser] = useState(false)
  const [showLocationSetter, setShowLocationSetter] = useState(false)
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

  // Auto-center map on client position once when first acquired
  const hasAutocentered = useRef(false)
  useEffect(() => {
    if (clientLocation.position && !hasAutocentered.current) {
      hasAutocentered.current = true
      setFocusTarget({ lat: clientLocation.position.lat, lng: clientLocation.position.lng })
    }
  }, [clientLocation.position])

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

  const silentCount = useMemo(() => {
    return liveData.aircraft.filter((a) => a.isActive === false && a.lastSeen !== null).length
  }, [liveData.aircraft])
  const hasSilentAircraft = silentCount > 0

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
    if (clientLocation.position) {
      setFollowUser(true)
      setFocusTarget({ lat: clientLocation.position.lat, lng: clientLocation.position.lng })
      setTimeout(() => setFollowUser(false), 100)
    } else {
      // No position held yet — trigger a fresh geolocation request
      clientLocation.requestLocation()
    }
  }, [clientLocation])

  const onManualSetLocation = useCallback((lat: number, lng: number) => {
    setShowLocationSetter(false)
    clientLocation.setManualLocation(lat, lng)
    setFocusTarget({ lat, lng })
  }, [clientLocation])

  const selectedAircraft = filteredAircraft.find((a) => a.id === selectedAircraftId)
  const selectedReport = filteredReports.find((r) => r.id === selectedReportId)

  const detailContent = selectedAircraft ? (
    <AircraftDetail aircraft={selectedAircraft} user={userPosition} scrubT={scrubT} onClose={onCloseDetail} />
  ) : selectedReport ? (
    <ReportDetail report={selectedReport} user={userPosition} onClose={onCloseDetail} />
  ) : null

  const clockStr = useMemo(() => {
    const d = new Date(systemClock)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }, [systemClock])

  const locationStr = useMemo(() => {
    if (clientLocation.position) {
      return `${clientLocation.position.lat.toFixed(3)}°, ${clientLocation.position.lng.toFixed(3)}°`
    }
    return clientLocation.permissionState === 'denied' ? 'LOCATION OFF' : 'NO FIX'
  }, [clientLocation.position, clientLocation.permissionState])

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

            {/* Secret aircraft indicator */}
            {silentCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--amber)' }}>SILENT</span>
                <span className="num text-[11px] font-bold" style={{ color: 'var(--amber)' }}>{silentCount}</span>
              </div>
            )}

            {silentCount > 0 && <div className="w-px h-5 bg-border" />}

            {/* History link */}
            <a
              href="/vicpol-history"
              className="px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.12em] uppercase text-fg-3 bg-ink-2 border border-border rounded hover:bg-ink-3 hover:text-fg-1 transition-colors"
            >
              HISTORY
            </a>

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

        {/* Main content area — map + right data panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* Map area */}
          <div className="flex-1 relative">
            <LazyMap
              aircraft={filteredAircraft}
              reports={filteredReports}
              user={userPosition}
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
              hasSilentAircraft={hasSilentAircraft}
            />

            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 px-2 py-1 rounded bg-ink-0/80 border border-border-subtle" style={{ backdropFilter: 'blur(8px)' }}>
              <span className={`num text-[9px] ${clientLocation.position ? 'text-fg-3' : 'text-[var(--amber)] font-semibold'}`}>
                {locationStr}
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="num text-[9px] text-fg-3">HDG ---°</span>
            </div>

            <FabCluster
              onLayers={() => setFilterOpen((v) => !v)}
              onFilters={() => setFilterOpen((v) => !v)}
              onRecenter={onRecenter}
              onSetLocation={() => setShowLocationSetter(true)}
              followUser={followUser}
            />

            {showLocationSetter && (
              <LocationSetter
                onSetLocation={onManualSetLocation}
                onClose={() => setShowLocationSetter(false)}
              />
            )}

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
          </div>

          {/* Right data grid panel — wider */}
          <div className="flex-shrink-0 w-[480px]">
            <DataGrid
              aircraft={filteredAircraft}
              reports={filteredReports}
              user={userPosition}
              scrubT={scrubT}
              selectedAircraftId={selectedAircraftId}
              selectedReportId={selectedReportId}
              onSelectAircraft={onSelectAircraft}
              onSelectReport={onSelectReport}
            />
          </div>
        </div>

        {/* Bottom dock: detail panel + time scrubber */}
        <div className="flex-shrink-0 border-t border-border bg-ink-1">
          {detailContent && (
            <div className="max-h-[280px] overflow-y-auto border-b border-border">
              <div className="p-3 flex gap-4">
                <div className="flex-1">{detailContent}</div>
              </div>
            </div>
          )}
          <TimeScrubber
            aircraft={liveData.aircraft}
            reports={liveData.reports}
            value={scrubT}
            onChange={setScrubT}
          />
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
          silentCount={silentCount}
        />

        <div
          className="absolute left-0 right-0"
          style={{ top: MOBILE_STRIP_H, height: MAP_H }}
        >
          <LazyMap
            aircraft={filteredAircraft}
            reports={filteredReports}
            user={userPosition}
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
            hasSilentAircraft={hasSilentAircraft}
          />

          <FabCluster
            onLayers={() => setFilterOpen((v) => !v)}
            onFilters={() => setFilterOpen((v) => !v)}
            onRecenter={onRecenter}
            onSetLocation={() => setShowLocationSetter(true)}
            followUser={followUser}
          />

          {showLocationSetter && (
            <LocationSetter
              onSetLocation={onManualSetLocation}
              onClose={() => setShowLocationSetter(false)}
            />
          )}

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
              user={userPosition}
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
