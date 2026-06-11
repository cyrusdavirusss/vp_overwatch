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
import { AIRCRAFT, REPORTS, USER, RELAY, sampleTrack } from '@/lib/data'

// Dynamically import the map component to avoid SSR issues with Leaflet
const VPMap = dynamic(() => import('@/components/map').then((mod) => mod.VPMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[var(--map-bg)]">
      <div className="text-fg-3 text-sm">Loading map...</div>
    </div>
  ),
})

// iPhone 16 viewport dimensions
const SCREEN_W = 393
const SCREEN_H = 852
const STRIP_H = 110 // 54px island clearance + 56px strip body
const SCRUB_H = 96

export default function VPOverwatch() {
  // Core state
  const [scrubT, setScrubT] = useState(0)
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('peek')
  const [filterOpen, setFilterOpen] = useState(false)
  const [followUser, setFollowUser] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [relayTick, setRelayTick] = useState(RELAY.lastTickAgo)

  // Filter state
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

  // Tick relay counter every second
  useEffect(() => {
    const id = setInterval(() => {
      setRelayTick((t) => (t + 1) % 60)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Filter aircraft and reports based on filters
  const filteredAircraft = useMemo(() => {
    return AIRCRAFT.filter((a) => {
      if (!filters.aircraft) return false
      if (a.role === 'rotary' && !filters.rotary) return false
      if (a.role === 'fixedwing' && !filters.fixedwing) return false
      return true
    })
  }, [filters])

  const filteredReports = useMemo(() => {
    return REPORTS.filter((r) => {
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
  }, [filters])

  // Map area height
  const MAP_H = SCREEN_H - STRIP_H - SCRUB_H

  // Selection handlers
  const onSelectAircraft = useCallback((id: string | null) => {
    setSelectedAircraftId(id)
    setSelectedReportId(null)
    if (id) {
      setSnap('half')
      const a = AIRCRAFT.find((x) => x.id === id)
      if (a) {
        const pos = sampleTrack(a.track, 0)
        if (pos) setFocusTarget({ lat: pos.lat, lng: pos.lng })
      }
    }
  }, [])

  const onSelectReport = useCallback((id: string | null) => {
    setSelectedReportId(id)
    setSelectedAircraftId(null)
    if (id) {
      setSnap('half')
      const r = REPORTS.find((x) => x.id === id)
      if (r) setFocusTarget({ lat: r.lat, lng: r.lng })
    }
  }, [])

  const onCloseDetail = useCallback(() => {
    setSelectedAircraftId(null)
    setSelectedReportId(null)
    setSnap('peek')
  }, [])

  const onRecenter = useCallback(() => {
    setFollowUser(true)
    setFocusTarget({ lat: USER.lat, lng: USER.lng })
    setTimeout(() => setFollowUser(false), 100)
  }, [])

  const selectedAircraft = filteredAircraft.find((a) => a.id === selectedAircraftId)
  const selectedReport = filteredReports.find((r) => r.id === selectedReportId)

  // Detail content for bottom sheet
  const detailContent = selectedAircraft ? (
    <AircraftDetail aircraft={selectedAircraft} scrubT={scrubT} onClose={onCloseDetail} />
  ) : selectedReport ? (
    <ReportDetail report={selectedReport} onClose={onCloseDetail} />
  ) : null

  return (
    <div className="min-h-screen bg-ink-0 flex items-center justify-center">
      {/* iPhone 16 Frame */}
      <div
        className="relative overflow-hidden bg-ink-0"
        style={{
          width: SCREEN_W,
          height: SCREEN_H,
          fontFamily: 'var(--font-ui)',
        }}
      >
        {/* Status Strip */}
        <StatusStrip
          aircraftCount={filteredAircraft.length}
          reportsCount={filteredReports.length}
          scrubT={scrubT}
          relay={{ ...RELAY, lastTickAgo: relayTick }}
        />

        {/* Map Host */}
        <div
          className="absolute left-0 right-0"
          style={{ top: STRIP_H, height: MAP_H }}
        >
          <VPMap
            aircraft={filteredAircraft}
            reports={filteredReports}
            user={USER}
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

          {/* Bottom Sheet */}
          {!filterOpen && (
            <BottomSheet
              aircraft={filteredAircraft}
              reports={filteredReports}
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

        {/* Time Scrubber */}
        <div
          className="absolute left-0 right-0 bottom-0"
          style={{ height: SCRUB_H }}
        >
          <TimeScrubber
            aircraft={AIRCRAFT}
            reports={REPORTS}
            value={scrubT}
            onChange={setScrubT}
          />
        </div>
      </div>
    </div>
  )
}
