'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { VPHeader } from '@/components/vp-header'
import { AnnouncementsBanner } from '@/components/announcements-banner'
import { OnAirBar as VPOnAirBar } from '@/components/on-air-bar'
import { FabCluster } from '@/components/fab-cluster'
import { WhatsNewPanel } from '@/components/whats-new'
import { hasSeenWhatsNew, markWhatsNewSeen } from '@/lib/whats-new'
import { AircraftDetail } from '@/components/aircraft-detail'
import { ReportDetail } from '@/components/report-detail'
import { FilterPanel, type Filters } from '@/components/filter-panel'
import { LocationSetter } from '@/components/location-setter'
import { LazyMap } from '@/components/lazy-map'
import { MlatBanner } from '@/components/mlat-banner'
import { AROverlay } from '@/components/ar-overlay'
import { SubscribeModal } from '@/components/subscribe-modal'
import { TermsGate } from '@/components/terms-gate'
import {
  VPSButton,
  SIGHTING_PICK_RANGE_M,
  HELI_SCOPE_AREA_M2,
  type VPSKind,
} from '@/components/vps-button'
import { RouteAlertPanel } from '@/components/route-alert-panel'
import { useRealtimeData, sampleTrack, type RealtimeData } from '@/hooks/useRealtimeData'
import { mockAircraft, mockRequested } from '@/lib/mock-flight'
import { useClientLocation } from '@/hooks/useClientLocation'
import { haversineMetres } from '@/lib/geo/haversine'
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

  // Landscape on a phone/tablet: the chrome scales to half size so the map gets the room while
  // every control stays on screen. Nothing is hidden, and this does NOT enter fullscreen — see
  // hooks/useImmersiveLandscape.ts for what that hook used to do and why it no longer does.
  const immersion = useImmersiveLandscape()

  /**
   * The chrome's REAL rendered height, measured rather than assumed.
   *
   * The map sits below the chrome, and that offset used to be the constant
   * MOBILE_STRIP_H + MOBILE_ONAIR_H. That was only correct while both were fixed. Now
   * the header scales itself to the width it is given (--vp-header-fit) and in
   * landscape the whole chrome is scaled to half (--vp-chrome-scale), so the stack's
   * height varies with the device and the orientation. A stale constant would either
   * leave a band of map hidden behind the chrome or a gap below it.
   *
   * Declared HERE, above the desktop early-return, because it is a hook: the app
   * switches between the desktop and mobile layouts on resize, and a hook placed after
   * that return would change the hook order between renders.
   *
   * getBoundingClientRect, not offsetHeight — it reports the RENDERED height, which is
   * what the map has to clear once zoom is in play.
   */
  const chromeRef = useRef<HTMLDivElement | null>(null)
  const [chromeHeight, setChromeHeight] = useState(76)
  useEffect(() => {
    const el = chromeRef.current
    if (!el) return
    const measure = () => setChromeHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The header's fit scale settles in its own layout pass, which can change the
  // stack's height without any resize event; one frame later keeps the map in step.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = chromeRef.current
      if (el) setChromeHeight(el.getBoundingClientRect().height)
    })
    return () => cancelAnimationFrame(id)
  }, [immersion.immersive])

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
      // Head-up and the north-up hold are contradictory camera rules. Turning head-up on
      // releases the hold, or the compass button looks dead: rotation stays refused and
      // the map will not turn to the phone.
      setNorthLock(false)
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
  // The locate control is ALWAYS rendered. It used to be hidden whenever a live GPS
  // fix existed — which removed the one control that answers "where am I?" at exactly
  // the moment it was wanted. An operator showing someone the map found no location
  // button, pressed Recenter instead, and the camera — already on them — barely moved,
  // so the control read as broken. Manual coordinate entry is still offered ONLY when
  // the browser genuinely cannot answer; that decision belongs in onSetLocationPressed,
  // not in whether the button exists.

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
  // Where the operator's key lives on their device. Not a secret we hold — a value the
  // operator enters once, that the server checks.
  const OPERATOR_KEY_STORAGE = 'vp-operator-key'

  const onReportHazard = useCallback(async (kind: VPSKind, coords?: { lat: number; lng: number; accuracyM?: number }) => {
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

    // A helicopter sighting is published to EVERY client without corroboration, so the
    // server accepts it only from the operator's key. The key is asked for once, on the
    // device, and kept on the device: it is never put in the bundle, and the only thing
    // it is ever sent to is this app's own API.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (kind === 'helicopter') {
      let key = ''
      try { key = localStorage.getItem(OPERATOR_KEY_STORAGE) || '' } catch { /* private mode */ }
      if (!key) {
        const entered = window.prompt('Operator key — required to broadcast a sighting to everyone')
        if (!entered?.trim()) return false
        key = entered.trim()
        try { localStorage.setItem(OPERATOR_KEY_STORAGE, key) } catch { /* private mode */ }
      }
      headers['x-admin-token'] = key
    }

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind, lat, lng, sessionId, accuracyM: coords?.accuracyM }),
      })
      // A rejected key is stale, not something to keep retrying with.
      if (res.status === 403 && kind === 'helicopter') {
        try { localStorage.removeItem(OPERATOR_KEY_STORAGE) } catch { /* ignore */ }
      }
      // Reported honestly: a tick that says SENT must not appear for a report that was
      // rate-limited, refused, or never left the device.
      return res.ok
    } catch {
      return false
    }
  }, [userPosition])

  const [scrubT, setScrubT] = useState(0)
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [snap, setSnap] = useState<'peek' | 'half'>('peek')
  const [filterOpen, setFilterOpen] = useState(false)
  const [followUser, setFollowUser] = useState(true)
  // Above this reported accuracy a fix may be drawn but must not drag the camera.
  const FIX_CAMERA_MAX_ACCURACY_M = 5000
  const [showLocationSetter, setShowLocationSetter] = useState(false)
  const [picking, setPicking] = useState(false)
  // Out-of-sight sighting: `sightingPick` arms the zoomed tap-to-place, and
  // `sightingPoint` holds what the operator tapped until VPSButton submits it.
  const [sightingPick, setSightingPick] = useState<{ lat: number; lng: number; rangeM: number; scopeAreaM2?: number } | null>(null)
  const [sightingPoint, setSightingPoint] = useState<{ lat: number; lng: number; accuracyM?: number } | null>(null)
  // Stealth-helicopter mode holds the map north-up for as long as it is armed.
  const [northLock, setNorthLock] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [fitAllCounter, setFitAllCounter] = useState(0)
  /**
   * Mirror of the live position for the placement callbacks. They must NOT depend on the
   * position value: rebuilding the pick target on every GPS tick re-ran the map's framing
   * effect and dragged the operator back to the wide view mid-placement, which made
   * "zoom in, then place it accurately" impossible. Reads the latest value at call time.
   */
  const userPositionRef = useRef(userPosition)
  useEffect(() => { userPositionRef.current = userPosition }, [userPosition])

  const [recenterCounter, setRecenterCounter] = useState(0)
  /** Set by an explicit location press so the next fix is used even if it is coarse. */
  const forceFocusRef = useRef(false)
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
    if (!followUser) return
    const p = clientLocation.position
    if (!p) return
    // A fix too coarse to be the user's position must not MOVE the camera. Network/IP
    // geolocation answers with kilometres of error and is the one case that reliably
    // lands the map in the wrong suburb; the dot still draws that fix, the camera just
    // waits for something real. 5 km is deliberately generous — it blocks an IP-level
    // answer without touching a phone GPS fix (metres) or desktop WiFi (hundreds of m).
    // ...unless the operator just pressed the location control. A press is a direct request
    // for their own position, so the next fix centres the map whatever its accuracy — a
    // coarse fix that is honestly labelled beats a button that appears to do nothing.
    if (p.accuracy > FIX_CAMERA_MAX_ACCURACY_M && !forceFocusRef.current) return
    forceFocusRef.current = false
    setFocusTarget({ lat: p.lat, lng: p.lng })
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
  /**
   * Overwatch: the ground report being ORBITED, or null when the view is off.
   * Holds a report id rather than a coordinate so the orbit always tracks the
   * live position of the unit it was pointed at, and so the map can pick the
   * right hollow model from the report's own kind.
   */
  const [overwatchReportId, setOverwatchReportId] = useState<string | null>(null)

  /**
   * Whether the aircraft tracking view holds on the operator's own position instead of the
   * contact. Reset whenever the view closes, so it can never silently open somewhere
   * unexpected the next time it is used.
   */
  const [overwatchUserView, setOverwatchUserView] = useState(false)
  /**
   * Overwatch can also target an AIRCRAFT.
   *
   * It used to accept a ground report only. Launching it with a helicopter selected therefore
   * fell through to `filteredReports[0]` and silently orbited the top-ranked speed camera — the
   * view opened on something the operator had not chosen, and there was no way to put the
   * rotational satellite view on an aircraft at all.
   *
   * An aircraft target behaves differently ON PURPOSE: no orbit. The camera holds a fixed
   * bearing and follows the contact, because the subject is already moving — sweeping a circle
   * around something that is itself travelling is two motions fighting each other.
   */
  const [overwatchAircraftId, setOverwatchAircraftId] = useState<string | null>(null)

  // ── What's New ──────────────────────────────────────────────────────────────
  // The release FLAG is device-local and read on the client only: it lives in
  // localStorage, so reading it during render would desync the server-rendered
  // markup (and localStorage does not exist during SSR at all).
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [whatsNewUnseen, setWhatsNewUnseen] = useState(false)
  useEffect(() => {
    setWhatsNewUnseen(!hasSeenWhatsNew())
  }, [])
  const openWhatsNew = useCallback(() => {
    setWhatsNewOpen(true)
    // Cleared on OPEN, not on close: the operator has been shown the notes the
    // moment they appear, and a flag that survives a glance would nag.
    markWhatsNewSeen()
    setWhatsNewUnseen(false)
  }, [])
  const whatsNew = whatsNewOpen ? (
    <WhatsNewPanel onClose={() => setWhatsNewOpen(false)} />
  ) : null
  const [showSubscribe, setShowSubscribe] = useState(false)
  const [pickingDest, setPickingDest] = useState(false)
  const [mapView, setMapView] = useState<MapViewType>('radar')
  const cycleMapView = useCallback(() => {
    const order: MapViewType[] = ['radar', 'dark', 'light', 'grayscale', 'satellite']
    setMapView((v) => order[(order.indexOf(v) + 1) % order.length])
  }, [])

  /**
   * Overwatch reads the GROUND a unit is standing on, so it forces the satellite
   * basemap: the radar/vector views stylise the terrain away, which removes exactly
   * what the operator opened the view to look at. The basemap live before Overwatch
   * is remembered and put back on exit, so leaving the view never silently changes a
   * map setting the operator chose.
   */
  const preOverwatchView = useRef<MapViewType | null>(null)
  /**
   * Satellite imagery appears in exactly ONE situation: while the rotational view is open.
   *
   * It is deliberately NOT tied to selection. An earlier pass also forced it whenever a unit was
   * selected, which meant a single tap on any contact flipped the entire basemap — reported as
   * "it still goes to sat view as soon as heli is selected". Selecting a contact is far too
   * common an action to carry a map-settings change.
   *
   * Nor is it revealed by panning or as a stand-in for missing vector data: auto-satellite used to
   * appear wherever the vector tiles ran out, painting a raster seam across outer Victoria.
   */
  const satelliteForced = overwatchReportId !== null || overwatchAircraftId !== null
  useEffect(() => {
    if (satelliteForced) {
      // Captured ONCE. Re-reading mapView on a later run would capture 'satellite'
      // itself and we would "restore" the operator to satellite.
      if (preOverwatchView.current === null) preOverwatchView.current = mapView
      if (mapView !== 'satellite') setMapView('satellite')
    } else if (preOverwatchView.current !== null) {
      setMapView(preOverwatchView.current)
      preOverwatchView.current = null
    }
    // Runs on entering/leaving those states only. `mapView` is read at that moment rather than
    // tracked — so a basemap the operator changes while one is active is still restored on exit,
    // instead of overwriting what was remembered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteForced])

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

  /**
   * Fly to the closest aircraft to me.
   *
   * "Closest" means closest to MY position, because the person pressing it is standing
   * somewhere and wants the airframe that is actually nearest them. With no fix yet it
   * falls back to the home point rather than refusing to work — a button that silently
   * does nothing is worse than one that is merely approximate.
   *
   * Pressing it again steps to the NEXT closest rather than re-selecting the same one, so
   * a second press is never a dead press. It wraps back to the closest at the end.
   *
   * Only aircraft that pass the current filters are candidates: flying to something the
   * operator has hidden would be its own bug.
   */
  const onNearestAircraft = useCallback(() => {
    // "Nearest to me" needs to know where "me" is. This used to fall back to the HOME
    // POINT when there was no fix, which silently answered a different question: it flew
    // the operator to whichever aircraft happened to be closest to the configured home
    // location, and on a machine whose owner lives there that reads as working correctly.
    // Ask instead — a press is a user gesture, so the browser will actually prompt.
    const fix = clientLocation.position
    if (!fix) {
      clientLocation.requestLocation()
      return
    }
    const from = { lat: fix.lat, lng: fix.lng }
    const ranked = filteredAircraft
      .map((a) => {
        const p = sampleTrack(a.track, 0)
        if (!p) return null
        const d = haversineMetres(from, { lat: p.lat, lng: p.lng })
        return Number.isFinite(d) ? { id: a.id, d } : null
      })
      .filter((x): x is { id: string; d: number } => x !== null)
      .sort((x, y) => x.d - y.d)
    if (ranked.length === 0) return
    const at = ranked.findIndex((x) => x.id === selectedAircraftId)
    onSelectAircraft(ranked[(at + 1) % ranked.length].id)
  }, [clientLocation.position, filteredAircraft, selectedAircraftId, onSelectAircraft, HOME_LAT, HOME_LNG])

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
    // A location press inside Overwatch has to LEAVE Overwatch first — and it has to do
    // that a FRAME before it moves the camera.
    //
    // Leaving Overwatch runs its teardown, and that teardown issues camera commands of its
    // own: setPitch(0) to flatten the view, and the north-up pin's setBearing(0). A camera
    // command CANCELS a running camera animation, so issuing the fly in the SAME commit let
    // the teardown kill it — measured live: the view flattened and stayed on the reported
    // mark, 72 km from the operator, never going to them at all.
    //
    // Deferring by one frame lets the teardown land first, so the fly is the last word.
    const leavingOverwatch = overwatchReportId !== null
    if (leavingOverwatch) setOverwatchReportId(null)

    const flyToOperator = () => {
      setFollowUser(true)
      // Bump the recenter trigger so the map flies to the operator on EVERY press, even
      // when the GPS fix is unchanged (otherwise the focus dedup swallows it).
      setRecenterCounter((c) => c + 1)
      forceFocusRef.current = true
      if (clientLocation.position) {
        setFocusTarget({ lat: clientLocation.position.lat, lng: clientLocation.position.lng })
        forceFocusRef.current = false
      } else {
        // No fix yet — ASK THE BROWSER. This used to centre on the home point "meanwhile",
        // which is worse than doing nothing: the map flies somewhere plausible and the
        // operator reads that as a successful fix. A request here is a user gesture, which is
        // exactly when the browser will show its permission prompt.
        clientLocation.requestLocation()
      }
    }

    if (leavingOverwatch) requestAnimationFrame(flyToOperator)
    else flyToOperator()
  }, [clientLocation, overwatchReportId])

  /**
   * Pressing the location control means "show me where I am" — not "let me type my
   * coordinates in". So it asks the browser first, and only falls back to manual entry when
   * the browser genuinely cannot answer: permission denied, no geolocation at all (insecure
   * origin, desktop with location services off). The manual path stays available, it just
   * stops being the first thing an operator is shown when all they wanted was their position.
   */
  const onSetLocationPressed = useCallback(() => {
    onRecenter()
    if (clientLocation.permissionState === 'denied' || clientLocation.permissionState === 'unavailable') {
      setShowLocationSetter(true)
    }
  }, [onRecenter, clientLocation.permissionState])

  /**
   * Fly to the closest ground contact — the police/camera pin nearest me, walking through
   * them on repeat presses exactly as the aircraft button does. Only pins passing the
   * current filters are candidates.
   */
  const onNearestGround = useCallback(() => {
    // Same rule as onNearestAircraft: never measure "nearest to me" from the home point.
    // Ranking by a location the operator is not at produces a confident, wrong answer.
    const fix = clientLocation.position
    if (!fix) {
      clientLocation.requestLocation()
      return
    }
    const from = { lat: fix.lat, lng: fix.lng }
    const ranked = filteredReports
      .map((r) => {
        const d = haversineMetres(from, { lat: r.lat, lng: r.lng })
        return Number.isFinite(d) ? { id: r.id, d } : null
      })
      .filter((x): x is { id: string; d: number } => x !== null)
      .sort((x, y) => x.d - y.d)
    if (ranked.length === 0) return
    const at = ranked.findIndex((x) => x.id === selectedReportId)
    onSelectReport(ranked[(at + 1) % ranked.length].id)
  }, [clientLocation.position, filteredReports, selectedReportId, onSelectReport, HOME_LAT, HOME_LNG])

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
    const at = userPositionRef.current
    setSightingPick({ lat: at.lat, lng: at.lng, rangeM: SIGHTING_PICK_RANGE_M })
  }, [])

  // ── STEALTH HELICOPTER — hold north-up, arm the tap, MOVE NOTHING ──────────────
  // This used to zoom the map out to half the state on arming. That was the wrong trade:
  // at that scale a fingertip is worth ±13 km, so the "helpful" wide view was the reason a
  // sighting could not be placed accurately — and it also fought the operator, who was
  // already looking at the part of the map where they had seen the aircraft. The view the
  // operator has is the frame now: the mode arms the tap and leaves the camera alone.
  // North is still held up, so a direction judged against the ground stays true. Following
  // is switched off, or the camera gets dragged back to the operator mid-placement.
  const onHelicopterMode = useCallback(() => {
    setSelectedAircraftId(null)
    setSelectedReportId(null)
    setFollowUser(false)
    setSightingPoint(null)
    setNorthLock(true)
    const at = userPositionRef.current
    // rangeM 0 and no scopeAreaM2: nothing to frame, so the map does not fly at all.
    setSightingPick({ lat: at.lat, lng: at.lng, rangeM: 0 })
  }, [])

  // A tap while armed records where the contact was seen. The pick stays armed
  // so a mis-tap is corrected by tapping again rather than starting over.
  const onMapClickSighting = useCallback((lat: number, lng: number, accuracyM?: number) => {
    setSightingPoint({ lat, lng, accuracyM })
  }, [])

  // Disarm. Called by VPSButton on cancel and after a successful submit.
  const onCancelSightingPick = useCallback(() => {
    setSightingPick(null)
    setSightingPoint(null)
    setNorthLock(false)
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

  // ── Overwatch launch control ──────────────────────────────────────────────
  // Overwatch orbits the selected ground unit and stands a hollow model on its
  // reported position. Anchored bottom-right of the UI, not bundled into the
  // map-control FAB cluster.
  const toggleOverwatch = useCallback(() => {
    // Leaving is always allowed, from either kind of target.
    if (overwatchReportId || overwatchAircraftId) {
      setOverwatchReportId(null)
      setOverwatchAircraftId(null)
      setOverwatchUserView(false)
      return
    }
    // The operator's OWN selection decides the target, and an aircraft is a legitimate one.
    // This accepted ground reports only: with a helicopter selected it fell through to
    // filteredReports[0] and silently orbited the top-ranked speed camera instead, so the view
    // opened on something the operator had not chosen.
    if (selectedAircraftId) {
      setOverwatchAircraftId(selectedAircraftId)
      setOverwatchReportId(null)
      return
    }
    // No aircraft selected — the selected ground unit, else the top-ranked report.
    setOverwatchReportId(selectedReportId ?? filteredReports[0]?.id ?? null)
  }, [overwatchReportId, overwatchAircraftId, selectedAircraftId, selectedReportId, filteredReports])

  const overwatchOn = overwatchReportId !== null || overwatchAircraftId !== null
  // An independent review measured that with no ground contacts this control simply
  // did nothing while looking live — the earlier comment here claimed the fallback
  // meant it "always does something", which is not true when the list is empty. It
  // is now disabled and says why. Exiting is always allowed.
  //
  // A selected AIRCRAFT is a target in its own right and needs no ground contact, so the
  // control is live when either exists.
  const overwatchAvailable = selectedAircraftId !== null || filteredReports.length > 0
  const overwatchLive = overwatchOn || overwatchAvailable
  // The label names the thing that will actually be opened on, because the two targets
  // behave differently — an aircraft is tracked on a fixed bearing, a ground unit is orbited.
  const overwatchLabel = overwatchOn
    ? 'Exit Overwatch'
    : selectedAircraftId
      ? 'Overwatch — track the selected aircraft'
      : overwatchAvailable
        ? 'Overwatch — orbit the selected ground unit'
        : 'Overwatch — nothing to open on'
  const arLaunch = (
    <button
      className="vp-chrome50"
      onClick={toggleOverwatch}
      disabled={!overwatchLive}
      aria-label={overwatchLabel}
      aria-pressed={overwatchOn}
      title={overwatchAvailable || overwatchOn ? 'Overwatch' : 'Overwatch — nothing to open on'}
      style={{
        // Rides ABOVE the mobile detail sheet, exactly as the FAB cluster does, by reading the
        // sheet's published top edge.
        //
        // It used to sit at a fixed bottom:20 with z-index 30, and the sheet was deliberately
        // stacked above it (z-index 35) because the pill was drawing over the sheet's lower rows
        // and hiding the heading value. The result was that selecting a unit — the very thing you
        // do before launching this — hid the control completely. Lifting it clear of the sheet
        // resolves both: the sheet keeps its rows, and the control is reachable while a unit is
        // selected.
        position: 'fixed',
        // Both layouts now render this pill, so the offset has to suit both.
        //
        // On the phone it rides ABOVE the mobile detail sheet, exactly as the FAB cluster does,
        // by reading the sheet's published top edge. It used to sit at a fixed bottom:20 with
        // z-index 30, and the sheet was deliberately stacked above it (z-index 35) because the
        // pill was drawing over the sheet's lower rows and hiding the heading value — so
        // selecting a unit, the very thing you do before launching this, hid the control.
        //
        // On DESKTOP there is no sheet; the constraint is the 26px status bar across the bottom
        // and the FAB cluster, whose lowest button starts 76px above the map area's own bottom
        // edge. 46px clears the status bar and still leaves a 30px gap to the cluster.
        bottom: isDesktop ? 46 : 'calc(var(--vp-panel-h, 0px) + 24px)',
        right: 16, zIndex: 34,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '11px 17px', borderRadius: 999,
        background: overwatchOn ? 'rgba(45,140,255,0.34)' : 'rgba(45,140,255,0.18)',
        border: `1px solid rgba(45,140,255,${overwatchOn ? '0.90' : '0.55'})`,
        color: 'var(--blue-hi)', backdropFilter: 'blur(8px)',
        fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
        boxShadow: '0 4px 18px rgba(0,0,0,0.45), 0 0 14px rgba(45,140,255,0.22)',
        cursor: overwatchLive ? 'pointer' : 'not-allowed',
        opacity: overwatchLive ? 1 : 0.45,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
      {overwatchOn ? 'EXIT OVERWATCH' : overwatchLive ? 'OVERWATCH' : 'OVERWATCH · PICK A CONTACT FIRST'}
    </button>
  )

  /**
   * "Hold the view on me" — offered ONLY while the aircraft tracking view is open, because that
   * is the only view in which it means anything.
   *
   * The view exists to read a patch of GROUND, and sometimes the patch that matters is the one
   * the operator is standing on. This points the same camera at a different point: bearing,
   * pitch and zoom are untouched.
   *
   * Disabled with no fix, and the tooltip says why rather than the control just looking dead —
   * the app never implies a position the device has not got. Same guard the map's own "you are
   * here" dot uses, and the status bar already reads NO FIX in that state.
   */
  const overwatchUserChip = overwatchOn ? (
    <button
      className="vp-chrome50"
      onClick={() => setOverwatchUserView((v) => !v)}
      disabled={!clientLocation.position !== null}
      aria-pressed={overwatchUserView}
      aria-label={overwatchUserView ? 'Tracking view is holding on your position — tap to follow the contact' : 'Hold the tracking view on your own position'}
      title={clientLocation.position !== null
        ? (overwatchUserView ? 'Holding on your position — tap to follow the contact' : 'Centre the view on your own position')
        : 'No GPS fix — the view cannot hold on a position this device has not got'}
      style={{
        position: 'fixed',
        bottom: isDesktop ? 94 : 'calc(var(--vp-panel-h, 0px) + 72px)',
        right: 16, zIndex: 34,
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '9px 14px', borderRadius: 999,
        background: overwatchUserView ? 'rgba(255,176,32,0.28)' : 'rgba(11,18,26,0.86)',
        border: `1px solid ${overwatchUserView ? 'rgba(255,176,32,0.85)' : 'var(--border)'}`,
        color: overwatchUserView ? 'var(--amber)' : 'var(--fg-2)',
        backdropFilter: 'blur(8px)',
        fontFamily: 'var(--font-mono, monospace)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
        cursor: clientLocation.position !== null ? 'pointer' : 'not-allowed',
        opacity: clientLocation.position !== null ? 1 : 0.5,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="10" r="3.2" />
        <path d="M12 21.5c4.6-5.6 7-9.3 7-12.1a7 7 0 1 0-14 0c0 2.8 2.4 6.5 7 12.1z" />
      </svg>
      {overwatchUserView ? 'ON MY POSITION' : 'MY LOCATION'}
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
          groundAgeSec={liveData.relay?.secondsSinceLastIngest}
          onSubscribeClick={() => setShowSubscribe(true)}
          onNearestAircraft={onNearestAircraft}
          onNearestGround={onNearestGround}
        />

        {/* ON AIR bar */}
        <VPOnAirBar
          aircraft={liveData.aircraft}
          selectedId={selectedAircraftId}
          onSelect={onSelectAircraft}
          onNearest={onNearestAircraft}
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

            {/* Overwatch sits SECOND, directly under Map view, and that placement IS the fix for
                "the button is gone".

                It used to live at the very BOTTOM of this rail, after the VPS report list — and
                that list is a `vp-rail-grow` section with its own inner scroll, so the fixed-height
                sections after it (Air/Gnd status, report detail, then the button) were pushed past
                the end of the rail. The rail has no outer scroll, only that list does, so there was
                nothing to scroll them into view. The control was in the DOM and clickable in
                automated tests at every width from 844px to 1600px while being physically
                unreachable on a real screen — which is exactly why a hard reload changed nothing.

                This is also the ONLY Overwatch control in the desktop layout. An earlier change
                added a second one beside it, believing the layout had none; it did, and the
                duplicate has been removed. */}
            <div className="vp-rail-section">
              <div className="vp-rail-title">Overwatch</div>
              <button
                className="vp-view-tab"
                style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                onClick={toggleOverwatch}
                aria-label={overwatchLabel}
                aria-pressed={overwatchOn}
                disabled={!overwatchLive}
                title={overwatchAvailable || overwatchOn ? 'Overwatch' : 'Overwatch — no ground contacts'}
              >
                {overwatchOn ? 'Exit Overwatch' : 'Launch Overwatch'}
              </button>
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
                onHelicopterMode={onHelicopterMode}
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
              hasUserFix={clientLocation.position !== null}
              selectedAircraftId={selectedAircraftId}
              selectedReportId={selectedReportId}
              overwatchReportId={overwatchReportId}
              overwatchAircraftId={overwatchAircraftId}
              overwatchUserView={overwatchUserView}
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
              northLock={northLock}
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
              onSetLocation={onSetLocationPressed}
              followUser={followUser}
              onFitAll={onFitAll}
              onRoute={() => setPickingDest(true)}
              onHeading={heading.supported ? onToggleHeading : undefined}
              headingActive={headingMode}
              heading={heading.heading}
              onArSky={() => setShowAR(true)}
              onWhatsNew={openWhatsNew}
              whatsNewUnseen={whatsNewUnseen}
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
        {/* AR Sky's overlay. Its LAUNCH control is the AR Sky button in the map's FAB
            cluster, which BOTH layouts render — so the overlay needs no launcher of
            its own here, and the two layouts cannot drift apart again. */}
        {arOverlay}
        {whatsNew}
        {/* The Overwatch pill lives on the MAP in both layouts, not only on the phone.
            It was mobile-only (rendered only in the other branch below), and the desktop
            layout's sole control was a 9px tab buried in the left rail under Map view —
            reachable, but the operator could not find it. This is the same element, same
            handler, so the two layouts cannot drift apart. */}
        {overwatchUserChip}
        {arLaunch}
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
  // Otherwise the map starts at the chrome's MEASURED height rather than a constant —
  // the header fits itself to the width and landscape halves the whole stack, so the
  // offset moves with the device. See chromeHeight above.
  const chromeH = chromeCollapsed ? 0 : Math.round(chromeHeight)

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
          ref={chromeRef}
          className="vp-chrome absolute left-0 right-0 top-0 z-20"
          style={{
            transform: chromeCollapsed
              ? `translateY(-${Math.round(chromeHeight)}px)`
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
            groundAgeSec={liveData.relay?.secondsSinceLastIngest}
            onSubscribeClick={() => setShowSubscribe(true)}
            onNearestAircraft={onNearestAircraft}
            onNearestGround={onNearestGround}
          />

          {/* ON AIR bar — persistent airframe indicator, never filtered */}
          <div style={{ height: MOBILE_ONAIR_H }}>
            <VPOnAirBar
              aircraft={liveData.aircraft}
              selectedId={selectedAircraftId}
              onSelect={onSelectAircraft}
              onNearest={onNearestAircraft}
            />
          </div>
        </div>

        {/* Collapse handle — sits on the seam between chrome and map. */}
        <button
          className="vp-chrome-collapse"
          style={{ top: chromeH, transition: 'top 240ms var(--ease-out, ease)' }}
          onClick={() => setChromeCollapsed((v) => !v)}
          aria-label={chromeCollapsed ? 'Show header' : 'Hide header'}
          title={chromeCollapsed ? 'Show header' : 'Hide header'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {chromeCollapsed ? <path d="M6 9l6 6 6-6" /> : <path d="M6 15l6-6 6 6" />}
          </svg>
        </button>

        {/* The landscape immersion TAB used to live here. It existed only to bring
            back chrome that landscape HID; landscape now scales the chrome to half
            instead of hiding any of it, so there is nothing to bring back and the
            tab is gone. `immersion.immersive` still drives that scale — through the
            data-vp-immersive attribute and the CSS in vp-theme.css. */}

        <div
          className="vp-map-area absolute left-0 right-0"
          style={{
            // In landscape the map starts at the very top and the half-scale chrome floats OVER
            // it — the chrome's height is deliberately not subtracted here. (This is why a
            // landscape map_top measures 0; it is intended, not a bug.)
            top: immersion.immersive ? 0 : chromeH,
            bottom: 0,
            transition: 'top 240ms var(--ease-out, ease)',
          }}
        >
          {isLostSignal && <div className="vp-map-lost-tint" />}
          <LazyMap
            aircraft={filteredAircraft}
            reports={allGroundContacts}
            user={userPosition}
            hasUserFix={clientLocation.position !== null}
            selectedAircraftId={selectedAircraftId}
            selectedReportId={selectedReportId}
            overwatchReportId={overwatchReportId}
            overwatchAircraftId={overwatchAircraftId}
            overwatchUserView={overwatchUserView}
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
            northLock={northLock}
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
              onHelicopterMode={onHelicopterMode}
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
            onSetLocation={onSetLocationPressed}
            followUser={followUser}
            onFitAll={onFitAll}
            onHeading={heading.supported ? onToggleHeading : undefined}
            headingActive={headingMode}
            heading={heading.heading}
            onArSky={() => setShowAR(true)}
            onWhatsNew={openWhatsNew}
            whatsNewUnseen={whatsNewUnseen}
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
      {overwatchUserChip}
      {arLaunch}
      {arOverlay}
      {whatsNew}
      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
      <TermsGate />
    </div>
  )
}
