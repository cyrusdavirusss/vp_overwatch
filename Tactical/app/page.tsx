'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { VPHeader } from '@/components/vp-header'
import { OnAirBar as VPOnAirBar } from '@/components/on-air-bar'
import { FabCluster } from '@/components/fab-cluster'
import { AircraftDetail } from '@/components/aircraft-detail'
import { ReportDetail } from '@/components/report-detail'
import { FilterPanel, type Filters } from '@/components/filter-panel'
import { LocationSetter } from '@/components/location-setter'
import { LazyMap } from '@/components/lazy-map'
import { MlatBanner } from '@/components/mlat-banner'
import { AROverlay } from '@/components/ar-overlay'
import { SubscribeModal } from '@/components/subscribe-modal'
import { RouteAlertPanel } from '@/components/route-alert-panel'
import { useRealtimeData, sampleTrack } from '@/hooks/useRealtimeData'
import { useClientLocation } from '@/hooks/useClientLocation'
import { useCommunityDots } from '@/hooks/useCommunityDots'
import { useRouteAlerts } from '@/hooks/useRouteAlerts'
import type { MapViewType } from '@/lib/map-style'
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
  const communityDots = useCommunityDots()
  // Live GPS fix present → hide the manual "Set Location" button; keep it only
  // as a fallback when GPS is denied/unavailable (e.g. served over plain HTTP).
  const gpsLive = clientLocation.permissionState === 'granted' && !clientLocation.isManual && clientLocation.position !== null

  // Home / default location. Desktop browsers can't GPS-locate, so when no
  // precise fix is available the map centers here instead of a generic
  // Melbourne CBD point. Configure via NEXT_PUBLIC_HOME_LAT/LNG (.env.local).
  const HOME_LAT = Number(process.env.NEXT_PUBLIC_HOME_LAT) || -37.8136
  const HOME_LNG = Number(process.env.NEXT_PUBLIC_HOME_LNG) || 144.9631

  // Derive a User object from the client-held position
  // Never sent over the network — lives only in React state.
  const userPosition: User = useMemo(() => ({
    lat: clientLocation.position?.lat ?? HOME_LAT,
    lng: clientLocation.position?.lng ?? HOME_LNG,
    hdg: 0,
    accuracy: clientLocation.position?.accuracy ?? 5000,
  }), [clientLocation.position, HOME_LAT, HOME_LNG])

  const routeAlerts = useRouteAlerts(liveData.aircraft, liveData.reports, userPosition.lat, userPosition.lng)

  const [scrubT, setScrubT] = useState(0)
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('peek')
  const [filterOpen, setFilterOpen] = useState(false)
  const [followUser, setFollowUser] = useState(true)
  const [showLocationSetter, setShowLocationSetter] = useState(false)
  const [picking, setPicking] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [fitAllCounter, setFitAllCounter] = useState(0)
  const [relayTick, setRelayTick] = useState(liveData.relay.lastTickAgo)
  const [systemClock, setSystemClock] = useState(Date.now())

  useEffect(() => { setRelayTick(liveData.relay.lastTickAgo) }, [liveData.relay.lastTickAgo])

  // Device orientation feeds the AR overlay (bearing/elevation via window.__vpOrientation).
  // iOS 13+ needs an explicit permission prompt (handled when AR opens), so skip auto-bind there.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') return
    const onOrient = (e: DeviceOrientationEvent) => {
      ;(window as any).__vpOrientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma }
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [])
  useEffect(() => {
    const id = setInterval(() => {
      setRelayTick((t) => t + 1)
      setSystemClock(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Live-follow: while follow is on, re-center on every position update so the
  // map tracks the user as they move (GPS devices). Panning the map or
  // selecting a unit turns follow off; the recenter FAB turns it back on.
  useEffect(() => {
    if (followUser && clientLocation.position) {
      setFocusTarget({ lat: clientLocation.position.lat, lng: clientLocation.position.lng })
    }
  }, [followUser, clientLocation.position])

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
  const isLostSignal = hasSilentAircraft

  // MLAT / "Blind Sky" awareness — count active aircraft by ADS-B source quality
  const mlatCount = useMemo(() => liveData.aircraft.filter((a) => a.isActive && a.isMlat).length, [liveData.aircraft])
  const modeSCount = useMemo(() => liveData.aircraft.filter((a) => a.isActive && a.isModeS).length, [liveData.aircraft])
  const [mlatBannerExpanded, setMlatBannerExpanded] = useState(false)
  const [showAR, setShowAR] = useState(false)
  const [showSubscribe, setShowSubscribe] = useState(false)
  const [pickingDest, setPickingDest] = useState(false)
  const [mapView, setMapView] = useState<MapViewType>('radar')
  const cycleMapView = useCallback(() => {
    const order: MapViewType[] = ['radar', 'dark', 'light', 'grayscale', 'satellite']
    setMapView((v) => order[(order.indexOf(v) + 1) % order.length])
  }, [])

  const onSelectAircraft = useCallback((id: string | null) => {
    setSelectedAircraftId(id)
    setSelectedReportId(null)
    if (id) {
      setFollowUser(false)
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
      setFollowUser(false)
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
    if (clientLocation.position) {
      setFocusTarget({ lat: clientLocation.position.lat, lng: clientLocation.position.lng })
    } else {
      // No precise fix yet — re-arm geolocation and center on home meanwhile.
      clientLocation.requestLocation()
      setFocusTarget({ lat: HOME_LAT, lng: HOME_LNG })
    }
  }, [clientLocation, HOME_LAT, HOME_LNG])

  const onFitAll = useCallback(() => {
    setFitAllCounter((c) => c + 1)
  }, [])

  const onManualSetLocation = useCallback((lat: number, lng: number) => {
    setShowLocationSetter(false)
    clientLocation.setManualLocation(lat, lng)
    setFocusTarget({ lat, lng })
  }, [clientLocation])

  // Switch from the coords modal into tap-the-map mode.
  const onPickOnMap = useCallback(() => {
    setShowLocationSetter(false)
    setPicking(true)
  }, [])

  // A map tap while picking a destination sets the route endpoint for Route Watch.
  const onMapClickSetDest = useCallback((lat: number, lng: number) => {
    routeAlerts.setDestinationPoint(lat, lng)
    setPickingDest(false)
    setFocusTarget({ lat, lng })
  }, [routeAlerts])

  // A map tap while picking sets the exact position, then exits pick mode.
  const onMapClickSetLocation = useCallback((lat: number, lng: number) => {
    setPicking(false)
    clientLocation.setManualLocation(lat, lng)
    setFocusTarget({ lat, lng })
  }, [clientLocation])

  const selectedAircraft = filteredAircraft.find((a) => a.id === selectedAircraftId)
  const selectedReport = filteredReports.find((r) => r.id === selectedReportId)

  const detailContent = selectedAircraft ? (
    <AircraftDetail aircraft={selectedAircraft} onClose={onCloseDetail} />
  ) : selectedReport ? (
    <ReportDetail report={selectedReport} user={userPosition} onClose={onCloseDetail} />
  ) : null

  const clockStr = useMemo(() => {
    const d = new Date(systemClock)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }, [systemClock])

  const locationStr = useMemo(() => {
    if (clientLocation.position) {
      const coords = `${clientLocation.position.lat.toFixed(3)}°, ${clientLocation.position.lng.toFixed(3)}°`
      return clientLocation.isManual ? `${coords} · PIN` : coords
    }
    return clientLocation.permissionState === 'denied' ? 'LOCATION OFF' : 'NO FIX'
  }, [clientLocation.position, clientLocation.permissionState, clientLocation.isManual])

  // ── Desktop: full Palantir multi-panel layout ──────────────────────────
  const arOverlay = showAR ? (
    <AROverlay
      aircraft={liveData.aircraft}
      communityDots={communityDots}
      userLocation={userPosition}
      onClose={() => setShowAR(false)}
    />
  ) : null

  if (isDesktop) {
    return (
      <div className="w-screen h-screen bg-ink-0 flex flex-col overflow-hidden" style={{ fontFamily: 'var(--font-ui)' }}>
        <VPHeader
          airCount={filteredAircraft.length}
          gndCount={filteredReports.length}
          silentCount={silentCount}
          isLostSignal={isLostSignal}
          isConnected={liveData.relay.connected}
          onSubscribeClick={() => setShowSubscribe(true)}
        />

        {/* ON AIR bar */}
        <VPOnAirBar
          aircraft={liveData.aircraft}
          selectedId={selectedAircraftId}
          onSelect={onSelectAircraft}
        />

        {/* Main content area — full-bleed map with overlay panels */}
        <div className="flex-1 relative">
          {isLostSignal && <div className="vp-map-lost-tint" />}
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
              pickMode={picking || pickingDest}
              onMapClick={picking ? onMapClickSetLocation : pickingDest ? onMapClickSetDest : undefined}
              followMode={followUser}
              onUserPan={() => setFollowUser(false)}
              fitAllTrigger={fitAllCounter}
              communityDots={communityDots}
              viewType={mapView}
            />

            {/* Map view pill */}
            <div className="vp-map-pill">
              {(['radar', 'dark', 'light', 'grayscale', 'satellite'] as const).map((v) => (
                <button key={v} className={`vp-map-pill-btn ${mapView === v ? 'active' : ''}`} onClick={() => setMapView(v)}>
                  {v === 'radar' ? 'RADAR' : v === 'dark' ? 'DARK' : v === 'light' ? 'LIGHT' : v === 'grayscale' ? 'GRAY' : 'SAT'}
                </button>
              ))}
            </div>

            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 px-2 py-1 rounded bg-ink-0/80 border border-border-subtle" style={{ backdropFilter: 'blur(8px)' }}>
              <span className={`num text-[9px] ${clientLocation.position ? 'text-fg-3' : 'text-[var(--amber)] font-semibold'}`}>
                {locationStr}
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="num text-[9px] text-fg-3">HDG ---°</span>
            </div>

            <FabCluster
              onLayers={cycleMapView}
              onFilters={() => setFilterOpen((v) => !v)}
              onRecenter={onRecenter}
              onSetLocation={gpsLive ? undefined : () => setShowLocationSetter(true)}
              followUser={followUser}
              onFitAll={onFitAll}
              onAR={() => setShowAR(true)}
              onRoute={() => setPickingDest(true)}
            />

            {/* Route awareness — destination pick hint + threat panel (desktop) */}
            {pickingDest && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3 py-1.5 rounded-md border border-[var(--blue)]" style={{ background: 'color-mix(in srgb, var(--ink-1) 95%, transparent)', backdropFilter: 'blur(8px)', boxShadow: 'var(--shadow-fab)' }}>
                <span className="font-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--blue)]">Tap your destination</span>
                <button onClick={() => setPickingDest(false)} className="font-mono text-[10px] tracking-[0.08em] uppercase text-fg-3 hover:text-fg-1">Cancel</button>
              </div>
            )}
            {routeAlerts.hasRoute && (
              <div className="absolute top-14 left-3 z-20 w-[300px]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[9px] font-bold tracking-[0.12em] uppercase text-fg-4">Route Watch</span>
                  <button onClick={routeAlerts.clearRoute} className="font-mono text-[9px] tracking-[0.08em] uppercase text-fg-3 hover:text-fg-1">Clear</button>
                </div>
                <RouteAlertPanel
                  result={routeAlerts.result}
                  onSelectAircraft={(ac) => onSelectAircraft(ac.id)}
                  onSelectReport={(r) => onSelectReport(r.id)}
                />
              </div>
            )}

            {/* MLAT / Blind-Sky awareness banner — bottom-left of the map */}
            <div className="absolute left-3 bottom-3 z-10 max-w-[300px]">
              <MlatBanner
                mlatCount={mlatCount}
                modeSCount={modeSCount}
                expanded={mlatBannerExpanded}
                onToggle={() => setMlatBannerExpanded((v) => !v)}
              />
            </div>

            {picking && (
              <div
                className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3 py-1.5 rounded-md border border-[var(--blue)]"
                style={{ background: 'color-mix(in srgb, var(--ink-1) 95%, transparent)', backdropFilter: 'blur(8px)', boxShadow: 'var(--shadow-fab)' }}
              >
                <span className="font-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--blue)]">Tap your location</span>
                <button
                  onClick={() => setPicking(false)}
                  className="font-mono text-[10px] tracking-[0.08em] uppercase text-fg-3 hover:text-fg-1"
                >
                  Cancel
                </button>
              </div>
            )}

            {showLocationSetter && (
              <LocationSetter
                onSetLocation={onManualSetLocation}
                onPickOnMap={onPickOnMap}
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
          {/* Aircraft detail — slide-in panel (right 280px on desktop) */}
          {selectedAircraft && (
            <AircraftDetail aircraft={selectedAircraft} onClose={onCloseDetail} />
          )}

          {/* Ground report detail — right panel */}
          {selectedReport && (
            <div className="absolute top-0 right-0 bottom-0 w-[320px] z-30 overflow-y-auto bg-ink-1 border-l border-border">
              <ReportDetail report={selectedReport} user={userPosition} onClose={onCloseDetail} />
            </div>
          )}
        </div>
        {arOverlay}
      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
      </div>
    )
  }

  // ── Mobile layout (original) ──────────────────────────────────────────
  const MOBILE_STRIP_H = 48
  const MOBILE_ONAIR_H = 28
  const MOBILE_SCRUB_H = 96
  const MAP_H = screenDims.h - MOBILE_STRIP_H - MOBILE_ONAIR_H - MOBILE_SCRUB_H

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
        <VPHeader
          airCount={filteredAircraft.length}
          gndCount={filteredReports.length}
          silentCount={silentCount}
          isLostSignal={isLostSignal}
          isConnected={liveData.relay.connected}
          onSubscribeClick={() => setShowSubscribe(true)}
        />

        {/* ON AIR bar — persistent airframe indicator, never filtered */}
        <div
          className="absolute left-0 right-0 z-10"
          style={{ top: MOBILE_STRIP_H, height: MOBILE_ONAIR_H }}
        >
          <VPOnAirBar
            aircraft={liveData.aircraft}
            selectedId={selectedAircraftId}
            onSelect={onSelectAircraft}
          />
        </div>

        <div
          className="absolute left-0 right-0"
          style={{ top: MOBILE_STRIP_H + MOBILE_ONAIR_H, bottom: 0 }}
        >
          {isLostSignal && <div className="vp-map-lost-tint" />}
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
            fitAllTrigger={fitAllCounter}
            communityDots={communityDots}
            viewType={mapView}
          />

          {/* Map view pill — floating top-center */}
          <div className="vp-map-pill">
            {(['radar', 'dark', 'light', 'grayscale', 'satellite'] as const).map((v) => (
              <button
                key={v}
                className={`vp-map-pill-btn ${mapView === v ? 'active' : ''}`}
                onClick={() => setMapView(v)}
              >
                {v === 'radar' ? 'RADAR' : v === 'dark' ? 'DARK' : v === 'light' ? 'LIGHT' : v === 'grayscale' ? 'GRAY' : 'SAT'}
              </button>
            ))}
          </div>

          <FabCluster
            onLayers={cycleMapView}
            onFilters={() => setFilterOpen((v) => !v)}
            onRecenter={onRecenter}
            onSetLocation={gpsLive ? undefined : () => setShowLocationSetter(true)}
            followUser={followUser}
            onFitAll={onFitAll}
            onAR={() => setShowAR(true)}
          />

          {/* MLAT / Blind-Sky awareness banner — bottom-left of the map */}
          <div className="absolute left-3 bottom-3 z-10 max-w-[300px]">
            <MlatBanner
              mlatCount={mlatCount}
              modeSCount={modeSCount}
              expanded={mlatBannerExpanded}
              onToggle={() => setMlatBannerExpanded((v) => !v)}
            />
          </div>

          {showLocationSetter && (
            <LocationSetter
              onSetLocation={onManualSetLocation}
              onPickOnMap={onPickOnMap}
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

          {/* Aircraft detail — slide-in overlay panel (bottom 60% on mobile) */}
          {selectedAircraft && (
            <AircraftDetail aircraft={selectedAircraft} onClose={onCloseDetail} />
          )}

          {/* Ground report detail — bottom overlay */}
          {selectedReport && (
            <div className="absolute left-0 right-0 bottom-0 z-30 max-h-[55%] overflow-y-auto bg-ink-1 border-t border-border">
              <ReportDetail report={selectedReport} user={userPosition} onClose={onCloseDetail} />
            </div>
          )}
        </div>
      </div>
      {arOverlay}
      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
    </div>
  )
}
