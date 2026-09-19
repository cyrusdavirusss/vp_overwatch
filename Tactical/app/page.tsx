'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { VPHeader } from '@/components/vp-header'
import { AnnouncementsBanner } from '@/components/announcements-banner'
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
import { TermsGate } from '@/components/terms-gate'
import { VPSButton, SIGHTING_PICK_RANGE_M, type VPSKind } from '@/components/vps-button'
import { RouteAlertPanel } from '@/components/route-alert-panel'
import { useRealtimeData, sampleTrack, type RealtimeData } from '@/hooks/useRealtimeData'
import { mockAircraft, mockRequested } from '@/lib/mock-flight'
import { useClientLocation } from '@/hooks/useClientLocation'
import { useCommunityDots } from '@/hooks/useCommunityDots'
import { useRouteAlerts } from '@/hooks/useRouteAlerts'
import { useImmersiveLandscape } from '@/hooks/useImmersiveLandscape'
import { useDeviceHeading } from '@/hooks/useDeviceHeading'
import type { MapViewType } from '@/lib/map-style'
import type { User, Report } from '@/lib/data'
import { isSilentContact } from '@/lib/data'

const STRIP_H = 36
const SCRUB_H = 64

export default function VPOverwatch() {
  const [isDesktop, setIsDesktop] = useState(false)
  // Multi-panel layout state. The left rail can be hidden so the map gets
  // everything back — the FAB cluster's filters button is the toggle.
  const [railLeftOpen, setRailLeftOpen] = useState(true)
  // Set once the user toggles the rail themselves, so responsive auto-collapse
  // stops overriding their choice.
  const railTouched = useRef(false)
  // Mobile: the header + ON AIR stack used to eat most of the viewport, so the
  // chrome collapses on demand and the map reclaims the space.
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
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

  // Landscape immersion (phone/tablet rotated sideways): the map gets the whole
  // screen and the chrome is hidden until something is selected or the user asks
  // for it back. See hooks/useImmersiveLandscape.ts for why fullscreen has to be
  // gesture-triggered rather than pure orientation-driven.
  const immersion = useImmersiveLandscape()

  // ── Head-up mode ────────────────────────────────────────────────────────────
  // Rotate the map to the direction the phone is facing. The compass has to be
  // started from a tap: iOS refuses motion permission requested outside a user
  // gesture, so this cannot be switched on at mount. The heading itself reaches
  // the map by ref, not props, so the frame-rate stream never re-renders the app.
  const heading = useDeviceHeading()
  const [headingMode, setHeadingMode] = useState(false)
  const onToggleHeading = useCallback(async () => {
    // Off is decided by the mode alone, never by whether data happens to be
    // flowing: if a sensor reports nothing (desktop, or permission refused) the
    // control would otherwise be stuck on with no way to cancel it. A stalled
    // stream does get a retry path, via the hook's `denied` flag.
    if (headingMode && !heading.denied) {
      heading.stop()
      setHeadingMode(false)
      return
    }
    await heading.start()
    setHeadingMode(true)
  }, [heading, headingMode])

  const realtime = useRealtimeData({
    // The backend fast-police loop refreshes adsb.lol every 3s (FAST_POLICE_INTERVAL);
    // poll the client at the same cadence so the map is near-real-time instead of
    // lagging up to 30s behind the store. /api/aircraft/active just returns in-memory
    // state (the OpenSky sub-poll is independently throttled to 60s), so this is cheap.
    aircraftInterval: 3_000,
    reportsInterval: 10_000,
    relayInterval: 3_000,
  })

  // ── Mock flight (?mock=1) — review fixture, never a default ─────────────────
  // Substituted HERE, at the single source of the aircraft feed, so every consumer
  // (map, counts, filtered list, detail panel, route alerts) sees the same synthetic
  // pair and nothing downstream needs a special case. It is gated on an explicit query
  // flag and labelled on screen: synthetic contacts that looked like real tracking would
  // break this app's rule about never implying more certainty than we have.
  const mockMode = useMemo(
    () => (typeof window !== 'undefined' ? mockRequested(window.location.search) : false),
    [],
  )
  const [mockTick, setMockTick] = useState(0)
  useEffect(() => {
    if (!mockMode) return
    // Same 3s cadence as the real feed, so dead-reckoning and the cones run their
    // production paths between updates rather than being handed a smooth stream.
    const id = setInterval(() => setMockTick((t) => t + 1), 3_000)
    return () => clearInterval(id)
  }, [mockMode])
  const liveData: RealtimeData = useMemo(
    () => (mockMode ? { ...realtime, aircraft: mockAircraft(Date.now()) } : realtime),
    // mockTick is the recompute trigger; it is deliberately not read in the body.
    [realtime, mockMode, mockTick],
  )

  // ── WazeAPI coverage boxes (operator-only overlay) ──────────────────────────
  // The endpoint answers only on a local origin, so on the live site this fetch returns
  // 404 and nothing is drawn — the collection footprint is not a public feature.
  const [coverage, setCoverage] = useState<GeoJSON.FeatureCollection | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/coverage', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.features) setCoverage(d.features as GeoJSON.FeatureCollection) })
      .catch(() => { /* not local, or the app is offline: simply no boxes */ })
    return () => { alive = false }
  }, [])

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

  // VPS — submit a community ground report. IN SIGHT pins the observer's own
  // position; OUT OF SIGHT passes the coordinate tapped on the zoomed map.
  const onReportHazard = useCallback(async (kind: VPSKind, coords?: { lat: number; lng: number }) => {
    let sessionId = ''
    try {
      sessionId = localStorage.getItem('vp-session') || ''
      if (!sessionId) {
        sessionId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        localStorage.setItem('vp-session', sessionId)
      }
    } catch { /* private mode — anon */ }
    const lat = coords?.lat ?? userPosition.lat
    const lng = coords?.lng ?? userPosition.lng
    try {
      await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, lat, lng, sessionId }),
      })
    } catch { /* best-effort */ }
  }, [userPosition])

  const [scrubT, setScrubT] = useState(0)
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('peek')
  const [filterOpen, setFilterOpen] = useState(false)
  const [followUser, setFollowUser] = useState(true)
  const [showLocationSetter, setShowLocationSetter] = useState(false)
  const [picking, setPicking] = useState(false)
  // Out-of-sight sighting: `sightingPick` arms the zoomed tap-to-place, and
  // `sightingPoint` holds what the operator tapped until VPSButton submits it.
  const [sightingPick, setSightingPick] = useState<{ lat: number; lng: number; rangeM: number } | null>(null)
  const [sightingPoint, setSightingPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [fitAllCounter, setFitAllCounter] = useState(0)
  const [recenterCounter, setRecenterCounter] = useState(0)
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
    aerodromes: true,
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

  // Ground contacts on the map: Waze police alerts plus community reports.
  // Police locations arrive via /api/waze/alerts — the relay POSTs them to
  // /api/waze/ingest, which writes the store's reports. (There was also a
  // separate /api/ground-units layer here; nothing ever fed it, so it has been
  // removed rather than left looking like a working source.)
  const allGroundContacts = useMemo(() => filteredReports, [filteredReports])

  const silentCount = useMemo(() => {
    return liveData.aircraft.filter((a) => isSilentContact(a)).length
  }, [liveData.aircraft])
  const hasSilentAircraft = silentCount > 0
  const isLostSignal = hasSilentAircraft

  // Header LIVE/OFFLINE status: online whenever a tracked aircraft is actually
  // airborne (proof the ADS-B feed is live), or the Waze relay is connected.
  const airborneCount = useMemo(() => liveData.aircraft.filter((a) => a.isActive).length, [liveData.aircraft])
  const isOnline = airborneCount > 0 || liveData.relay.connected

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
    // Bump the recenter trigger so the map flies to the user on every press, even
    // when the GPS fix is unchanged (otherwise the focus dedup swallows it).
    setRecenterCounter((c) => c + 1)
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

  // A mock flight you cannot see is worse than none: the map opens on the whole state,
  // so bring the synthetic pair into view once, after they exist.
  const mockFitDone = useRef(false)
  useEffect(() => {
    if (!mockMode || mockFitDone.current || liveData.aircraft.length === 0) return
    mockFitDone.current = true
    onFitAll()
  }, [mockMode, liveData.aircraft, onFitAll])

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

  // ── OUT OF SIGHT — zoom onto the observer and arm tap-to-place ──────────
  // The operator is here; the unit they saw is not. Open the map on their own
  // position at a range they can point at accurately, and keep following off so
  // the camera doesn't get dragged back while they aim.
  const onPickSighting = useCallback(() => {
    setSelectedAircraftId(null)
    setSelectedReportId(null)
    setFollowUser(false)
    setSightingPoint(null)
    setSightingPick({ lat: userPosition.lat, lng: userPosition.lng, rangeM: SIGHTING_PICK_RANGE_M })
  }, [userPosition.lat, userPosition.lng])

  // A tap while armed records where the contact was seen. The pick stays armed
  // so a mis-tap is corrected by tapping again rather than starting over.
  const onMapClickSighting = useCallback((lat: number, lng: number) => {
    setSightingPoint({ lat, lng })
  }, [])

  // Disarm. Called by VPSButton on cancel and after a successful submit.
  const onCancelSightingPick = useCallback(() => {
    setSightingPick(null)
    setSightingPoint(null)
  }, [])

  const selectedAircraft = filteredAircraft.find((a) => a.id === selectedAircraftId)
  const selectedReport = filteredReports.find((r) => r.id === selectedReportId)

  const detailContent = selectedAircraft ? (
    <AircraftDetail aircraft={selectedAircraft} onClose={onCloseDetail} user={userPosition} />
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
      reports={allGroundContacts}
      communityDots={communityDots}
      userLocation={userPosition}
      onClose={() => setShowAR(false)}
    />
  ) : null

  // Dedicated AR launch control — its own feature, anchored bottom-right of the
  // UI (not bundled into the map-control FAB cluster).
  const arLaunch = !showAR ? (
    <button
      onClick={() => setShowAR(true)}
      aria-label="AR Sky — point your phone at aircraft"
      title="AR Sky"
      style={{
        position: 'fixed', bottom: 20, right: 16, zIndex: 30,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '11px 17px', borderRadius: 999,
        background: 'rgba(45,140,255,0.18)', border: '1px solid rgba(45,140,255,0.55)',
        color: 'var(--blue-hi)', backdropFilter: 'blur(8px)',
        fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
        boxShadow: '0 4px 18px rgba(0,0,0,0.45), 0 0 14px rgba(45,140,255,0.22)', cursor: 'pointer',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
      AR SKY
    </button>
  ) : null

  /** Compact relative age for the VPS report list. `reportedAgo` is in SECONDS. */
  const formatAgo = (secs?: number | null): string => {
    if (secs == null) return '—'
    if (secs < 60) return 'now'
    const m = Math.floor(secs / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
  }

  // The rails are 544px together, so on a laptop or tablet they would out-weigh
  // the map — which the brief forbids ("the MAP MUST remain the central visual
  // surface"). Below 1180px the left rail auto-collapses, and it reopens at
  // >=1280px, unless the user has toggled it by hand.
  useEffect(() => {
    const apply = () => {
      if (railTouched.current) return
      setRailLeftOpen(window.innerWidth >= 1180)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  // In landscape immersion the desktop three-column layout is wrong even on a
  // large tablet: the whole point is an unobstructed map, so immersion wins.
  if (isDesktop && !immersion.immersive) {
    return (
      <div className="w-screen h-screen bg-ink-0 flex flex-col overflow-hidden" style={{ fontFamily: 'var(--font-ui)' }}>
        <VPHeader
          airCount={filteredAircraft.length}
          gndCount={allGroundContacts.length}
          silentCount={silentCount}
          isLostSignal={isLostSignal}
          isConnected={isOnline}
          lastUpdate={liveData.lastUpdate}
          onSubscribeClick={() => setShowSubscribe(true)}
        />

        {/* ON AIR bar */}
        <VPOnAirBar
          aircraft={liveData.aircraft}
          selectedId={selectedAircraftId}
          onSelect={onSelectAircraft}
        />

        {/* Main content — three columns: left rail, map, right rail. The panels
            sit AROUND the map instead of on top of it, so the map stops being
            buried under chips while remaining the largest single surface. */}
        <div className="flex-1 flex min-h-0">
          {railLeftOpen && (
          <aside className="vp-rail vp-rail-left">
            <div className="vp-rail-section">
              <div className="vp-rail-title">Map view</div>
              <div className="vp-view-tabs">
                {(['radar', 'dark', 'light', 'grayscale', 'satellite'] as const).map((v) => (
                  <button
                    key={v}
                    className={`vp-view-tab ${mapView === v ? 'active' : ''}`}
                    onClick={() => setMapView(v)}
                  >
                    {v === 'radar' ? 'RADAR' : v === 'dark' ? 'DARK' : v === 'light' ? 'LIGHT' : v === 'grayscale' ? 'GRAY' : 'SAT'}
                  </button>
                ))}
              </div>
            </div>

            <div className="vp-rail-section">
              <div className="vp-rail-title">Layers &amp; filters</div>
              <FilterPanel
                embedded
                filters={filters}
                onFilterChange={setFilters}
                onClose={() => setRailLeftOpen(false)}
              />
            </div>

            {/* Report submission lived as a red-bordered chip floating over the
                map, where it read as an orphaned callout with no geographic
                anchor. It belongs in the rail with the rest of the reporting UI. */}
            <div className="vp-rail-section">
              <div className="vp-rail-title">Report a contact</div>
              <VPSButton
                onReport={onReportHazard}
                onPickSighting={onPickSighting}
                pickedPoint={sightingPoint}
                onCancelPick={onCancelSightingPick}
              />
            </div>

            <div className="vp-rail-section vp-rail-grow">
              <div className="vp-rail-title">
                <span>VPS report</span>
                <span className="text-fg-5">{allGroundContacts.length}</span>
              </div>
              {allGroundContacts.length === 0 ? (
                <div className="vp-empty">No ground contacts</div>
              ) : (
                allGroundContacts.slice(0, 40).map((r) => (
                  <button
                    key={r.id}
                    className={`vp-vps-row ${selectedReportId === r.id ? 'active' : ''}`}
                    onClick={() => onSelectReport(r.id)}
                  >
                    <span className="vp-vps-time">{formatAgo(r.reportedAgo)}</span>
                    <span className="vp-vps-desc">{r.descr || r.street || r.kind}</span>
                  </button>
                ))
              )}
            </div>
          </aside>
          )}

          <main className="flex-1 relative min-w-0">
          {isLostSignal && <div className="vp-map-lost-tint" />}
            <LazyMap
              aircraft={filteredAircraft}
              reports={allGroundContacts}
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
                aerodromes: filters.aerodromes,
              }}
              focusTarget={focusTarget}
              hasSilentAircraft={hasSilentAircraft}
              pickMode={picking || pickingDest || sightingPick !== null}
              onMapClick={
                picking ? onMapClickSetLocation
                  : pickingDest ? onMapClickSetDest
                    : sightingPick ? onMapClickSighting
                      : undefined
              }
              pickTarget={sightingPick}
              followMode={followUser}
              onUserPan={() => setFollowUser(false)}
              headingMode={headingMode}
              headingRef={heading.headingRef}
              coverage={coverage}
              fitAllTrigger={fitAllCounter}
              recenterTrigger={recenterCounter}
              communityDots={communityDots}
              viewType={mapView}
            />

            {/* Map-view tabs now live in the left rail — the reference dashboard
                puts them in the sidebar rather than floating over the map. */}

            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 px-2 py-1 rounded bg-ink-0/80 border border-border-subtle" style={{ backdropFilter: 'blur(8px)' }}>
              <span className={`num text-[9px] ${clientLocation.position ? 'text-fg-3' : 'text-[var(--amber)] font-semibold'}`}>
                {locationStr}
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="num text-[9px] text-fg-3">HDG ---°</span>
            </div>

            {/* VPS report submission now lives in the left rail (see "Report a
                contact"), so nothing floats over the map here. */}

            <FabCluster
              onLayers={cycleMapView}
              onFilters={() => { railTouched.current = true; setRailLeftOpen((v) => !v) }}
              onRecenter={onRecenter}
              onSetLocation={gpsLive ? undefined : () => setShowLocationSetter(true)}
              followUser={followUser}
              onFitAll={onFitAll}
              onRoute={() => setPickingDest(true)}
              onHeading={heading.supported ? onToggleHeading : undefined}
              headingActive={headingMode}
              heading={heading.heading}
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

            {/* Operator announcements — top-centre, dismissed per notice */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[min(560px,calc(100%-1.5rem))]">
              <AnnouncementsBanner />
            </div>

            {/* Mock flight is labelled where it cannot be missed: synthetic contacts must
                never read as real tracking, not even in a screenshot. */}
            {mockMode && (
              <div
                className="absolute top-3 left-3 z-30 px-2 py-1 rounded border font-mono text-[10px] tracking-[0.12em] uppercase"
                style={{
                  borderColor: 'var(--vp-amber)',
                  color: 'var(--vp-amber)',
                  background: 'color-mix(in srgb, var(--ink-1) 92%, transparent)',
                }}
              >
                Mock flight — synthetic aircraft, not real traffic
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

            {/* OUT OF SIGHT — tapped-point confirmation while the pick is armed */}
            {sightingPick && (
              <div
                className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3 py-1.5 rounded-md border border-[var(--amber)]"
                style={{ background: 'color-mix(in srgb, var(--ink-1) 95%, transparent)', backdropFilter: 'blur(8px)', boxShadow: 'var(--shadow-fab)' }}
              >
                <span className="font-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--amber)]">
                  {sightingPoint
                    ? `Seen at ${sightingPoint.lat.toFixed(5)}, ${sightingPoint.lng.toFixed(5)} — tap to adjust`
                    : `Contact out of sight — tap where you saw it`}
                </span>
                <button
                  onClick={onCancelSightingPick}
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
            <AircraftDetail aircraft={selectedAircraft} onClose={onCloseDetail} user={userPosition} />
          )}

          </main>

          {/* ── RIGHT RAIL ── */}
          <aside className="vp-rail vp-rail-right">
            <div className="vp-rail-section">
              <div className="vp-rail-title">Air / Gnd status</div>
              <div className="vp-stat-grid">
                <div className="vp-stat-card">
                  <div className={`vp-stat-num ${filteredAircraft.length ? 'is-live' : ''}`}>
                    {String(filteredAircraft.length).padStart(2, '0')}
                  </div>
                  <div className="vp-stat-label">Aircraft tracked</div>
                </div>
                <div className="vp-stat-card">
                  <div className={`vp-stat-num ${allGroundContacts.length ? 'is-live' : ''}`}>
                    {String(allGroundContacts.length).padStart(2, '0')}
                  </div>
                  <div className="vp-stat-label">Ground active</div>
                </div>
                <div className="vp-stat-card">
                  <div className="vp-stat-num">{String(silentCount).padStart(2, '0')}</div>
                  <div className="vp-stat-label">Silent</div>
                </div>
                <div className="vp-stat-card">
                  <div className="vp-stat-num">{String(mlatCount + modeSCount).padStart(2, '0')}</div>
                  <div className="vp-stat-label">MLAT / Mode-S</div>
                </div>
              </div>
            </div>

            <div className="vp-rail-section vp-rail-grow">
              <div className="vp-rail-title">VPS report detail</div>
              {selectedReport ? (
                <ReportDetail report={selectedReport} user={userPosition} onClose={onCloseDetail} />
              ) : (
                <div className="vp-empty">Select a contact from the report list</div>
              )}
            </div>

            <div className="vp-rail-section">
              <div className="vp-rail-title">AR Sky</div>
              <button
                className="vp-view-tab"
                style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                onClick={() => setShowAR(true)}
              >
                Launch AR
              </button>
            </div>
          </aside>
        </div>

        {/* Bottom status bar. Only values the app actually holds — relay state,
            poll interval, coverage, last update. The reference shows a version
            string; this app has none, so none is shown rather than inventing one. */}
        <footer className="vp-status-bar">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`vp-status-dot ${isOnline ? 'on' : 'off'}`} />
            {isOnline ? 'System online' : 'System offline'}
          </span>
          <span>Feed {liveData.relay?.connected ? 'connected' : 'offline'}</span>
          {liveData.relay?.pollIntervalSec ? (
            <span>Poll {Math.round(liveData.relay.pollIntervalSec / 60)} min</span>
          ) : null}
          {liveData.relay?.coverageRegions ? (
            <span>Coverage {liveData.relay.coverageRegions} regions</span>
          ) : null}
          <span>
            Last update{' '}
            {liveData.lastUpdate
              ? new Date(liveData.lastUpdate).toLocaleTimeString('en-AU', { hour12: false })
              : '—'}
          </span>
          {/* Vendor-required credit (WazeAPI terms): a visible line, and never
              presented as Waze or Google data — WazeAPI is an independent
              collection/delivery service with no affiliation to either. */}
          <span>Road events via WazeAPI (wazeapi.com)</span>
        </footer>
        {/* The floating AR launcher is mobile-only: on desktop the right rail
            carries an AR Sky panel, so rendering both would be two controls for
            one action. */}
        {arOverlay}
      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
      <TermsGate />
      </div>
    )
  }

  // ── Mobile layout (original) ──────────────────────────────────────────
  const MOBILE_STRIP_H = 48
  const MOBILE_ONAIR_H = 28
  const MOBILE_SCRUB_H = 96
  const MAP_H = screenDims.h - MOBILE_STRIP_H - MOBILE_ONAIR_H - MOBILE_SCRUB_H
  // Collapsed, the chrome leaves the viewport entirely and the map starts at 0.
  const chromeH = chromeCollapsed ? 0 : MOBILE_STRIP_H + MOBILE_ONAIR_H

  return (
    <div className={immersion.immersive
      ? 'w-screen h-[100dvh] overflow-hidden bg-ink-0'
      : 'min-h-screen bg-ink-0 flex items-center justify-center'}>
      <div
        className={`relative overflow-hidden bg-ink-0 ${immersion.immersive ? 'vp-imm-frame' : ''}`}
        style={{
          // Immersion uses the real viewport: the mobile frame exists to preview a
          // phone-sized layout, but in landscape the device IS the frame.
          width: immersion.immersive ? '100vw' : screenDims.w,
          height: immersion.immersive ? '100dvh' : screenDims.h,
          fontFamily: 'var(--font-ui)',
        }}
      >
        {/* Collapsible chrome: header + ON AIR bar together. On a phone this
            stack consumed the top of the screen, so the handle below slides it
            away and the map takes the space back — it resizes itself through the
            ResizeObserver in components/map.tsx. */}
        <div
          className="vp-chrome absolute left-0 right-0 top-0 z-20"
          style={{
            transform: chromeCollapsed
              ? `translateY(-${MOBILE_STRIP_H + MOBILE_ONAIR_H}px)`
              : 'none',
          }}
        >
          <VPHeader
            airCount={filteredAircraft.length}
            gndCount={allGroundContacts.length}
            silentCount={silentCount}
            isLostSignal={isLostSignal}
            isConnected={isOnline}
            lastUpdate={liveData.lastUpdate}
            onSubscribeClick={() => setShowSubscribe(true)}
          />

          {/* ON AIR bar — persistent airframe indicator, never filtered */}
          <div style={{ height: MOBILE_ONAIR_H }}>
            <VPOnAirBar
              aircraft={liveData.aircraft}
              selectedId={selectedAircraftId}
              onSelect={onSelectAircraft}
            />
          </div>
        </div>

        {/* Collapse handle — sits on the seam between chrome and map. */}
        <button
          className="vp-chrome-collapse vp-imm-hide"
          style={{ top: chromeH, transition: 'top 240ms var(--ease-out, ease)' }}
          onClick={() => setChromeCollapsed((v) => !v)}
          aria-label={chromeCollapsed ? 'Show header' : 'Hide header'}
          title={chromeCollapsed ? 'Show header' : 'Hide header'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {chromeCollapsed ? <path d="M6 9l6 6 6-6" /> : <path d="M6 15l6-6 6 6" />}
          </svg>
        </button>

        {/* Landscape immersion control — the only chrome left once the phone is
            sideways. Everything else is hidden by CSS. The fullscreen button
            rides along with the reveal because the Fullscreen API requires a
            gesture: it cannot be triggered by the rotation itself. */}
        {immersion.immersive && (
          <div className="vp-imm-handle">
            <button
              onClick={immersion.toggleReveal}
              aria-label={immersion.revealed ? 'Hide controls' : 'Show controls'}
              title={immersion.revealed ? 'Hide controls' : 'Show controls'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {immersion.revealed ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
              </svg>
            </button>
            {immersion.revealed && (
              <button
                onClick={immersion.toggleFullscreen}
                aria-label={immersion.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={immersion.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  {immersion.fullscreen
                    ? <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M15 21h4a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4" />
                    : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
                </svg>
              </button>
            )}
          </div>
        )}

        <div
          className="vp-map-area absolute left-0 right-0"
          style={{
            // Immersion reclaims the chrome's height — the map starts at the very top.
            top: immersion.immersive ? 0 : chromeH,
            bottom: 0,
            transition: 'top 240ms var(--ease-out, ease)',
          }}
          // Touching the map in immersion puts the chrome away again; panels opened
          // by a selection are unaffected, since they are their own surfaces.
          onPointerDown={immersion.immersive ? immersion.conceal : undefined}
        >
          {isLostSignal && <div className="vp-map-lost-tint" />}
          <LazyMap
            aircraft={filteredAircraft}
            reports={allGroundContacts}
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
              aerodromes: filters.aerodromes,
            }}
            focusTarget={focusTarget}
            hasSilentAircraft={hasSilentAircraft}
            pickMode={picking || pickingDest || sightingPick !== null}
            onMapClick={
              picking ? onMapClickSetLocation
                : pickingDest ? onMapClickSetDest
                  : sightingPick ? onMapClickSighting
                    : undefined
            }
            pickTarget={sightingPick}
            // These two were only passed to the DESKTOP map, so on a phone the
            // map never entered follow mode. Without followMode every GPS fix
            // took the one-off "fly to" branch instead of live following, and
            // without onUserPan a deliberate pan could not stop the follow.
            // The phone is the primary client — this is the layout that matters.
            followMode={followUser}
            onUserPan={() => setFollowUser(false)}
            coverage={coverage}
            fitAllTrigger={fitAllCounter}
            recenterTrigger={recenterCounter}
            communityDots={communityDots}
            viewType={mapView}
            headingMode={headingMode}
            headingRef={heading.headingRef}
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

          {/* VPS — community report button (left side) */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
            <VPSButton
              onReport={onReportHazard}
              onPickSighting={onPickSighting}
              pickedPoint={sightingPoint}
              onCancelPick={onCancelSightingPick}
            />
          </div>

          {/* OUT OF SIGHT — tapped-point confirmation while the pick is armed */}
          {sightingPick && (
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-2 py-1 rounded-md border border-[var(--amber)]"
              style={{ background: 'color-mix(in srgb, var(--ink-1) 95%, transparent)', backdropFilter: 'blur(8px)' }}
            >
              <span className="font-mono text-[9px] font-semibold tracking-[0.08em] uppercase text-[var(--amber)] whitespace-nowrap">
                {sightingPoint ? 'Tap to adjust' : 'Tap where you saw it'}
              </span>
              <button
                onClick={onCancelSightingPick}
                className="font-mono text-[9px] tracking-[0.08em] uppercase text-fg-3 hover:text-fg-1"
              >
                Cancel
              </button>
            </div>
          )}

          <FabCluster
            onLayers={cycleMapView}
            onFilters={() => setFilterOpen((v) => !v)}
            onRecenter={onRecenter}
            onSetLocation={gpsLive ? undefined : () => setShowLocationSetter(true)}
            followUser={followUser}
            onFitAll={onFitAll}
            onHeading={heading.supported ? onToggleHeading : undefined}
            headingActive={headingMode}
            heading={heading.heading}
          />

          {/* Operator announcements — top-centre, dismissed per notice */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[min(560px,calc(100%-1.5rem))]">
            <AnnouncementsBanner />
          </div>

          {/* Mock flight label (see the desktop branch for why) */}
          {mockMode && (
            <div
              className="absolute top-3 left-3 z-30 px-2 py-1 rounded border font-mono text-[10px] tracking-[0.12em] uppercase"
              style={{
                borderColor: 'var(--vp-amber)',
                color: 'var(--vp-amber)',
                background: 'color-mix(in srgb, var(--ink-1) 92%, transparent)',
              }}
            >
              Mock flight — synthetic aircraft, not real traffic
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
            <AircraftDetail aircraft={selectedAircraft} onClose={onCloseDetail} user={userPosition} />
          )}

          {/* Ground report detail — bottom overlay */}
          {selectedReport && (
            <div className="vp-report-sheet absolute left-0 right-0 bottom-0 z-30 max-h-[55%] overflow-y-auto bg-ink-1 border-t border-border">
              <ReportDetail report={selectedReport} user={userPosition} onClose={onCloseDetail} />
            </div>
          )}
        </div>
      </div>
      {arLaunch}
      {arOverlay}
      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
      <TermsGate />
    </div>
  )
}
