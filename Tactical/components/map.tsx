'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Aircraft,
  Report,
  User,
  sampleTrack,
  sampleTrailUntil,
  computeDistance,
} from '@/lib/data'
import { buildMapStyle, registerPmtilesProtocol, outsideCoverage, type MapViewType } from '@/lib/map-style'
import type { CommunityDot } from '@/lib/visual-sighting'
import { aircraftMarkerSVG, reportMarkerSVG, isGlowingKind, RED, BLUE } from '@/lib/markers'
import { deadReckon } from '@/lib/geo/dead-reckoning'
import { visionConeForAltitude, visionConeSVG, metresPerPixel } from '@/lib/pilot-vision'
import { zoomInByPercentCapped } from '@/lib/zoom'

// Register the pmtiles:// protocol once, at the map module root. This module
// is only ever loaded client-side (via the lazy map loader), so it is safe to
// run at evaluation time; the call is idempotent.
registerPmtilesProtocol()

export interface VPMapProps {
  aircraft: Aircraft[]
  reports: Report[]
  user: User
  selectedAircraftId: string | null
  selectedReportId: string | null
  onSelectAircraft: (id: string | null) => void
  onSelectReport: (id: string | null) => void
  scrubT: number
  layers: {
    aircraft: boolean
    reports: boolean
    trails: boolean
    predictive: boolean
    aerodromes: boolean
  }
  focusTarget?: { lat: number; lng: number } | null
  hasSilentAircraft?: boolean
  /** When true, the map shows a crosshair and a click sets the position. */
  pickMode?: boolean
  /** Called with the clicked coordinate while pickMode is active. */
  onMapClick?: (lat: number, lng: number) => void
  /**
   * Out-of-sight sighting pick: on change, fly to this point at a zoom that
   * frames `rangeM` metres of radius on screen so the operator can tap the
   * exact spot they saw the contact from. Callers must keep the object
   * reference stable (state, not a fresh literal each render) or the camera
   * will keep re-flying.
   */
  pickTarget?: { lat: number; lng: number; rangeM: number } | null
  /** Live-follow: re-center smoothly (pan only, keep zoom) on focus changes. */
  followMode?: boolean
  /** Fired when the user drags the map, so follow mode can be paused. */
  onUserPan?: () => void
  /** Increment to trigger fit-all-aircraft bounds. */
  fitAllTrigger?: number
  /** Increment to force a re-center on the user, even if coords are unchanged. */
  recenterTrigger?: number
  /**
   * WazeAPI police coverage boxes, from /api/coverage (which only answers on a local
   * origin). Null or empty on the public site, where this is not drawn at all.
   */
  coverage?: GeoJSON.FeatureCollection | null
  /** Crowdsourced community sighting dots (approximate positions). */
  communityDots?: CommunityDot[]
  /** Basemap view mode (radar / dark / light / grayscale / satellite). */
  viewType?: MapViewType
  /**
   * Head-up mode. When true the map's bearing follows the device compass and
   * user rotation is disabled, so a stray two-finger twist cannot fight it.
   */
  headingMode?: boolean
  /** Live compass heading (degrees from north). Read per frame, never via state. */
  headingRef?: React.MutableRefObject<number | null>
}

// Motion: 400ms camera-focus duration with the design system's spring ease
// (cubic-bezier(0.32,0.72,0,1) ≈ stiffness 260 / damping 28). Aircraft
// positions interpolate over ~900ms so live polls never snap.
const FOCUS_MS = 400
const FOCUS_ZOOM = 10
const AIRCRAFT_TWEEN_MS = 900

/**
 * How long a marker may keep being predicted forward from its last fix.
 *
 * The poll gap is 3s and polls do occasionally fail, so a marker needs some room — but
 * not unlimited room. Past this the marker stops where it is and the app's existing
 * silent/stale styling takes over, because a contact we have not heard from for a minute
 * should look parked, not still cruising. deadReckon() also caps its own extrapolation
 * at 30s, so this is the outer limit of a smaller inner one.
 */
const AIRCRAFT_PREDICT_MAX_SEC = 60

// ── Out-of-sight sighting pick ─────────────────────────────────────────────
// MapLibre lays out the world as 2^zoom tiles of 512 px, so the ground
// resolution at the equator and zoom 0 is 40075017 / 512 ≈ 78 271 m/px:
//   metres/px = 78271.5 * cos(lat) / 2^zoom
// Invert that for the zoom whose shorter viewport axis spans `rangeM` of
// radius (i.e. the full shorter side covers 2 × rangeM), so no matter the
// screen the operator gets their radius without the view being uselessly wide.
const WORLD_M_PER_PX_Z0 = 78271.51696
const PICK_MIN_ZOOM = 14
const PICK_MAX_ZOOM = 19
const PICK_MS = 650

function zoomForRadius(rangeM: number, lat: number, el: HTMLElement | null): number {
  const w = el?.clientWidth || 360
  const h = el?.clientHeight || 640
  const halfAxisPx = Math.max(1, Math.min(w, h) / 2)
  const mPerPx = rangeM / halfAxisPx
  const z = Math.log2((WORLD_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / mPerPx)
  return Math.max(PICK_MIN_ZOOM, Math.min(PICK_MAX_ZOOM, z))
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

// cubic-bezier(0.32, 0.72, 0, 1) — the --ease-spring token, sampled for flyTo.
function springEase(t: number): number {
  return easeBezier(0.32, 0.72, 0, 1, t)
}
function easeBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  // Solve t for the given x via bisection, then evaluate y(t).
  const bx = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const by = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 24; i++) {
    const cx = bx(t)
    if (Math.abs(cx - x) < 1e-4) break
    if (cx < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return by(t)
}

// Geodesic-ish circle polygon (metres) for accuracy / density overlays.
function circlePolygon(
  lng: number,
  lat: number,
  radiusM: number,
  steps = 48
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = []
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}

interface AircraftMarkerEntry {
  marker: maplibregl.Marker
  rot: HTMLDivElement
  callout: HTMLDivElement
  cur: [number, number]
  raf: number | null
  /**
   * The latest known fix, kept so the prediction loop can advance the marker between
   * polls. ts is when the FIX was made (absolute), not when we received it — otherwise
   * a payload that arrives late would be predicted as if it were fresh.
   */
  fix: { lat: number; lng: number; headingDeg: number | null; groundSpeedKt: number | null; ts: number } | null
  /** Live contacts are predicted forward; a silent ghost stays where it was last seen. */
  live: boolean
  /** The forward-visibility cone: rotated with heading, sized from altitude and zoom. */
  vision: HTMLDivElement | null
  /** Key of the cone currently drawn, so an unchanged cone is not rebuilt every frame. */
  coneKey: string
  /** Altitude in metres (the source is feet) and heading, for the cone. */
  altM: number | null
  hdg: number
  /** The airframe's role, because the two roles see differently (lib/pilot-vision.ts). */
  role: Aircraft['role']
  /** Stable id used to keep this marker's cone gradient unique on the map. */
  markerId: string
}

export function VPMap({
  aircraft,
  reports,
  user,
  selectedAircraftId,
  selectedReportId,
  onSelectAircraft,
  onSelectReport,
  scrubT,
  layers,
  focusTarget,
  hasSilentAircraft,
  pickMode,
  onMapClick,
  pickTarget,
  followMode,
  onUserPan,
  fitAllTrigger,
  coverage,
  recenterTrigger,
  communityDots = [],
  viewType = 'radar',
  headingMode = false,
  headingRef,
}: VPMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  // ── Head-up mode ────────────────────────────────────────────────────────────
  // The compass heading arrives at frame rate, so this deliberately does NOT go
  // through React state: it reads the ref inside its own loop and only pushes to
  // MapLibre when the bearing has moved further than the eye can ignore. While
  // head-up is on, user rotation is disabled — otherwise a two-finger twist and
  // the compass fight over the bearing and the map judders.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (!headingMode) {
      if (!map.dragRotate.isEnabled()) map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
      map.setBearing(0)
      return
    }

    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()

    let raf = 0
    let applied = map.getBearing()
    const tick = () => {
      const h = headingRef?.current
      if (h != null && Number.isFinite(h)) {
        const target = ((h % 360) + 360) % 360
        let diff = target - applied
        if (diff > 180) diff -= 360
        if (diff < -180) diff += 360
        if (Math.abs(diff) > 0.6) {
          applied = ((applied + diff) % 360 + 360) % 360
          map.setBearing(applied)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (!map.dragRotate.isEnabled()) map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
    }
  }, [headingMode, headingRef, ready])
  // Set when the map cannot be created at all — no WebGL context, or a context
  // lost mid-session. Without this the throw escapes to the page-level error
  // boundary and the entire app becomes "This page couldn't load", so a client
  // with WebGL blocked loses the header, alerts and aircraft too.
  const [initError, setInitError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const onMapClickRef = useRef(onMapClick)
  useEffect(() => { onMapClickRef.current = onMapClick }, [onMapClick])
  const onUserPanRef = useRef(onUserPan)
  useEffect(() => { onUserPanRef.current = onUserPan }, [onUserPan])
  const followModeRef = useRef(followMode)
  useEffect(() => { followModeRef.current = followMode }, [followMode])
  // Guards the focus effect from issuing redundant camera moves for a target
  // it has already centred on.
  const lastFocusRef = useRef<string | null>(null)

  const userMarker = useRef<maplibregl.Marker | null>(null)
  const aircraftMarkers = useRef<Map<string, AircraftMarkerEntry>>(new Map())
  const reportMarkers = useRef<Map<string, maplibregl.Marker>>(new Map())
  const communityMarkers = useRef<Map<string, maplibregl.Marker>>(new Map())
  const lastViewType = useRef<MapViewType>(viewType)
  const lastScrubT = useRef(scrubT)
  // Remember the fit-all trigger value we last acted on, so the effect only
  // fires on an actual user request (the counter incrementing) and NOT on the
  // initial mount or on every aircraft data poll (which would yank the camera
  // off the user onto the planes). Seeded with the initial trigger value.
  const lastFitTrigger = useRef(fitAllTrigger)
  // Remember the recenter trigger we last acted on. Pressing the locate FAB
  // bumps this counter; an explicit press must always fly back to the user even
  // when the GPS fix (and thus focusTarget) is unchanged — so a press clears the
  // focus dedup below.
  const lastRecenterTrigger = useRef(recenterTrigger)

  // ── Initialise map once ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // MapLibre needs a WebGL context, and it THROWS from its constructor when it
    // cannot get one: hardware acceleration disabled, an anti-detect/spoofing
    // browser, iOS Low Power Mode, or an in-app WebView. Probe first so the
    // message names the real cause, and catch regardless — an uncaught throw in
    // this effect escapes to Next's error boundary and takes the whole page
    // down, not just the map.
    let map: maplibregl.Map
    try {
      if (!webglAvailable()) throw new Error('WebGL is unavailable in this browser')
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(viewType),
        center: [user.lng, user.lat],
        zoom: 9,
        pitch: 0, // pitch/bearing enabled but default flat, north up
        bearing: 0,
        attributionControl: false,
        dragRotate: true,
        pitchWithRotate: true,
      })
    } catch (err) {
      console.error('[VP-MAP INIT FAILED]', err)
      setInitError(err instanceof Error ? err.message : String(err))
      return
    }
    mapRef.current = map
    setInitError(null)

    // iOS reclaims GPU memory under pressure and the context can be lost later,
    // leaving a frozen or blank canvas. Treat it as a map failure so RETRY can
    // rebuild the map instead of showing a dead rectangle.
    const canvas = map.getCanvas()
    const onContextLost = (e: Event) => {
      e.preventDefault()
      console.error('[VP-MAP] WebGL context lost')
      mapRef.current = null
      try { map.remove() } catch { /* already torn down */ }
      setInitError('The map lost its graphics context')
    }
    canvas.addEventListener('webglcontextlost', onContextLost)

    // Surface basemap/source/tile errors instead of failing silently to a black
    // screen. Logs to console always; in dev (or with ?mapdebug) also paints a
    // visible overlay so a blank map is diagnosable on a phone in the field.
    map.on('error', (e: any) => {
      const msg = e?.error?.message || e?.error?.status || String(e?.error || e)
      // eslint-disable-next-line no-console
      console.error('[VP-MAP ERROR]', e?.error || e)
      const debug =
        process.env.NODE_ENV !== 'production' ||
        (typeof window !== 'undefined' && window.location.search.includes('mapdebug'))
      if (!debug || typeof document === 'undefined') return
      let box = document.getElementById('__vp_maperr')
      if (!box) {
        box = document.createElement('div')
        box.id = '__vp_maperr'
        box.style.cssText =
          'position:fixed;top:120px;left:8px;right:8px;z-index:99999;background:rgba(40,0,0,.9);color:#ff8888;font:11px/1.4 monospace;padding:8px;white-space:pre-wrap;max-height:40vh;overflow:auto;border:1px solid #f44'
        document.body.appendChild(box)
      }
      box.textContent = (box.textContent ? box.textContent + '\n' : '') + msg
    })

    // Tap-to-set position (only acts when pickMode is on, via the live callback).
    map.on('click', (e) => {
      onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng)
    })

    // Any deliberate camera interaction pauses live-follow — but ONLY a real one.
    // MapLibre fires zoomstart / pitchstart / rotatestart for PROGRAMMATIC camera
    // moves as well, which made this fire on every locate press (it zooms), on
    // every flyTo, and on the opening fit. Each one silently switched follow off,
    // and from then on the map stopped tracking the user: the dot drove away and
    // the camera stayed put. Events from a gesture carry originalEvent; the ones
    // MapLibre generates for its own animations do not.
    const pauseFollow = (e?: { originalEvent?: unknown }) => {
      if (!e || !e.originalEvent) return
      onUserPanRef.current?.()
    }
    map.on('dragstart', pauseFollow)
    map.on('zoomstart', pauseFollow)
    map.on('pitchstart', pauseFollow)
    map.on('rotatestart', pauseFollow)

    // Ground-report callouts only render when zoomed in enough to read them
    // without clutter. Class toggle on the container, CSS does the rest.
    const REPORT_CALLOUT_MIN_ZOOM = 12
    const syncCalloutZoom = () => {
      containerRef.current?.classList.toggle(
        'vp-callouts-tight',
        map.getZoom() < REPORT_CALLOUT_MIN_ZOOM
      )
    }
    map.on('zoom', syncCalloutZoom)
    syncCalloutZoom()

    // Satellite fallback: keep the tactical vector view pure radar, and only
    // reveal the (hidden) Esri underlay when the map centre leaves the
    // Melbourne-only vector coverage — following an aircraft out to a region the
    // vector basemap doesn't cover. Inside coverage it stays fully off (no
    // external tiles). Skips satellite mode, where Esri is the whole basemap.
    map.on('moveend', () => applySatFallback(map))

    map.on('load', () => {
      // ── Data-overlay sources + layers (idempotent; re-added after style swaps) ──
      addVpOverlays(map)
      applySatFallback(map)

      // User position marker (DOM) — dot + pulse.
      const uel = document.createElement('div')
      uel.className = 'user-marker'
      uel.innerHTML =
        '<div class="user-marker-dot"></div><div class="user-marker-pulse"></div>'
      userMarker.current = new maplibregl.Marker({ element: uel, anchor: 'center' })
        .setLngLat([user.lng, user.lat])
        .addTo(map)

      setReady(true)
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      ro.disconnect()
      aircraftMarkers.current.forEach((e) => {
        if (e.raf) cancelAnimationFrame(e.raf)
        e.marker.remove()
      })
      aircraftMarkers.current.clear()
      reportMarkers.current.forEach((m) => m.remove())
      reportMarkers.current.clear()
      communityMarkers.current.forEach((m) => m.remove())
      communityMarkers.current.clear()
      userMarker.current?.remove()
      userMarker.current = null
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey])

  // ── Map view switcher: swap the basemap, then re-add overlay layers ─────
  // Swap the basemap and keep the imperatively-managed overlays on top of it.
  // NB: setStyle defaults to { diff: true }, which KEEPS the existing overlay
  // layers/sources but appends the new basemap on top of them — so switching to
  // the satellite raster buried the trails/markers-vectors under the opaque
  // Esri imagery. (Forcing diff:false is worse: the raster style's async tile
  // load leaves isStyleLoaded()=false, so a deferred re-add never fires and the
  // overlays vanish entirely.) So we KEEP the diff, and simply re-assert order:
  // addVpOverlays is idempotent (re-adds only if a reload dropped them), then we
  // move every overlay to the top. We listen on `styledata` (not once) so order
  // is re-asserted as the raster source finishes loading, detaching after 4s.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (lastViewType.current === viewType) return
    lastViewType.current = viewType
    const OVERLAY_IDS = ['vp-aerodrome-dot', 'vp-aerodrome-label', 'vp-aerodrome-label-small', 'vp-hex-fill', 'vp-hex-line', 'vp-conn-line', 'vp-trails-line', 'vp-acc-fill', 'vp-acc-line', 'vp-predict-line']
    const fixOrder = () => {
      try {
        addVpOverlays(map)
        for (const id of OVERLAY_IDS) if (map.getLayer(id)) map.moveLayer(id) // no beforeId → top
        applySatFallback(map)
      } catch { /* style mid-swap — the styledata listener will retry */ }
    }
    map.setStyle(buildMapStyle(viewType))
    fixOrder()
    map.on('styledata', fixOrder)
    const t = setTimeout(() => map.off('styledata', fixOrder), 4000)
    return () => { clearTimeout(t); map.off('styledata', fixOrder) }
  }, [ready, viewType])

  // The aerodrome overlay is STATIC data, so unlike the imperatively-updated
  // overlays it cannot be gated by feeding it empty features — and a style swap
  // re-adds its layers, which would silently ignore the filter toggle. So set
  // visibility here and re-assert it on every styledata.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const ids = ['vp-aerodrome-dot', 'vp-aerodrome-label', 'vp-aerodrome-label-small']
    const apply = () => {
      const vis = layers.aerodromes ? 'visible' : 'none'
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    }
    apply()
    map.on('styledata', apply)
    return () => { map.off('styledata', apply) }
  }, [ready, layers.aerodromes])

  // ── Camera focus (flyTo with momentum + spring ease) ───────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focusTarget) return

    // A locate-FAB press is distinguishable from an ordinary follow update: it
    // bumps recenterTrigger. That matters because the two want different camera
    // behaviour — a press zooms in a step, a follow update must not touch zoom.
    const pressedLocate = recenterTrigger !== lastRecenterTrigger.current
    if (pressedLocate) {
      lastRecenterTrigger.current = recenterTrigger
      // Clear the dedup so a press recentres even onto identical coords.
      lastFocusRef.current = null
    }

    // Skip if we've already centred on this exact target.
    const focusKey = `${focusTarget.lng},${focusTarget.lat}`
    if (lastFocusRef.current === focusKey) return
    lastFocusRef.current = focusKey

    if (pressedLocate) {
      // Locate press: centre on the user AND zoom in by a quarter of the current
      // scale. Repeated presses keep stepping in. The default easing is used
      // deliberately — a spring overshoots, which reads as a wobble when the
      // destination is the user's own position.
      map.easeTo({
        center: [focusTarget.lng, focusTarget.lat],
        zoom: zoomInByPercentCapped(map.getZoom(), map.getMaxZoom()),
        duration: 700,
        essential: true,
      })
    } else if (followMode) {
      // Live follow: pan only, keep the user's current zoom, short ease. Was
      // 800ms with a spring easing, which never settled between GPS fixes — each
      // new fix restarted the animation, so the map lagged behind the user and
      // overshot as it chased.
      map.easeTo({
        center: [focusTarget.lng, focusTarget.lat],
        duration: 450,
        essential: true,
      })
    } else {
      // Deliberate focus (select a unit): fly in with momentum.
      map.flyTo({
        center: [focusTarget.lng, focusTarget.lat],
        zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
        duration: FOCUS_MS,
        easing: springEase,
        essential: true,
      })
    }
  }, [ready, focusTarget, followMode, recenterTrigger])

  // ── Fit all aircraft into view ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || fitAllTrigger === undefined || aircraft.length === 0) return
    // Only act when the user actually pressed "fit all" (trigger changed). This
    // guard also stops the effect from firing on mount and on every poll, which
    // was hijacking the opening camera onto an aircraft instead of the user.
    if (fitAllTrigger === lastFitTrigger.current) return
    lastFitTrigger.current = fitAllTrigger
    const coords = aircraft
      .map((a) => [a.longitude, a.latitude] as [number, number])
    if (coords.length === 0) return
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.fitBounds(bounds, { padding: 60, duration: 600, easing: springEase, essential: true })
  }, [ready, fitAllTrigger, aircraft])

  // ── Pick-location cursor ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''
  }, [ready, pickMode])

  // ── Out-of-sight pick: frame the observer, then let them tap the contact ─
  // North-up and flat, so a tap lands where the operator expects: the two
  // sighting paths differ only in WHERE the pin lands, never in which way the
  // map happens to be facing while they place it.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !pickTarget) return
    const zoom = zoomForRadius(pickTarget.rangeM, pickTarget.lat, map.getContainer())
    map.flyTo({
      center: [pickTarget.lng, pickTarget.lat],
      zoom,
      bearing: 0,
      pitch: 0,
      duration: PICK_MS,
      easing: springEase,
      essential: true,
    })
  }, [ready, pickTarget])

  // ── User marker + accuracy disc ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    userMarker.current?.setLngLat([user.lng, user.lat])
    const src = map.getSource('vp-acc') as maplibregl.GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: user.accuracy > 0 ? [circlePolygon(user.lng, user.lat, user.accuracy)] : [],
    })
  }, [ready, user.lat, user.lng, user.accuracy])

  // ── Aircraft markers, trails, predictive vector, connections, density ──
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    const scrubbing = !(scrubT === 0 && lastScrubT.current === 0)
    lastScrubT.current = scrubT

    const positions = aircraft.map((a) => ({ a, pos: sampleTrack(a.track, scrubT) }))

    // Aircraft markers (create / update / interpolate / prune).
    const live = new Set<string>()
    if (layers.aircraft) {
      for (const { a, pos } of positions) {
        if (!pos) continue
        live.add(a.id)
        const target: [number, number] = [pos.lng, pos.lat]
        const isSel = a.id === selectedAircraftId

        let entry = aircraftMarkers.current.get(a.id)
        if (!entry) {
          const el = document.createElement('div')
          el.className = 'vp-ac-marker'
          const rot = document.createElement('div')
          rot.className = 'vp-ac-rot'
          rot.innerHTML = aircraftMarkerSVG(a.role, 36)
          el.appendChild(rot)
          // Floating callout above the icon — callsign + live alt/spd.
          // Lives outside the rotating wrapper so it never tilts with heading.
          const callout = document.createElement('div')
          callout.className = 'vp-ac-callout'
          callout.innerHTML =
            `<div class="vp-co-callsign"></div><div class="vp-co-data"></div><div class="vp-co-stem"></div>`
          el.appendChild(callout)
          // The forward-visibility cone lives in its own rotated wrapper, because it must
          // follow the heading for BOTH kinds — the rotary glyph deliberately does not.
          const vision = document.createElement('div')
          vision.className = 'vp-ac-vision'
          vision.title = 'Estimated forward visibility — a model (20/20 acuity, Johnson detection, clear air), not a sensor spec'
          el.appendChild(vision)
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat(target)
            .addTo(map)
          entry = {
            marker, rot, callout, cur: target, raf: null, fix: null, live: false,
            vision, coneKey: '', altM: null, hdg: 0, role: a.role, markerId: a.id,
          }
          aircraftMarkers.current.set(a.id, entry)
        }

        // Callout content refreshes every data pass.
        const cs = entry.callout.querySelector('.vp-co-callsign') as HTMLDivElement
        const cd = entry.callout.querySelector('.vp-co-data') as HTMLDivElement
        // Codename-led label from the API ("King Air POL35"), falling back to
        // callsign then registration for older payloads.
        if (cs) cs.textContent = a.label || a.callsign || a.registration
        if (cd) cd.textContent = `${pos.alt != null ? pos.alt.toLocaleString() + 'ft' : '—'} · ${Math.round(pos.spd)}kts`

        // The nose leads for BOTH kinds: the body rotates with the heading.
        //
        // An earlier pass removed this for the helicopter because the wheel-around was
        // distracting ("kill that helicopter rotation its too much") — that was BEFORE
        // dead-reckoning, when the heading jumped once every three seconds and a rotation
        // snapped 30-90 degrees at a time. It now turns continuously, so the body can
        // follow the track without the jump, and the rotor spins inside this rotating
        // wrapper so the blades still read as spinning independently of the body.
        entry.rot.style.transform = `rotate(${pos.hdg}deg)`
        const markerEl = entry.marker.getElement() as HTMLDivElement
        markerEl.classList.toggle('selected', isSel)
        // Silent (off-ADS-B) aircraft read as a last-known/maybe-landed ghost,
        // never a live airborne contact. Map remaining fuel onto a deliberately
        // low 0.2–0.5 opacity band so EVEN a freshly-silent, near-full-tank
        // contact is visibly ghosted (the old 0.18–0.8 band left a 70%-fuel
        // contact at ~0.7 — indistinguishable from an active one); it then fades
        // further toward 0.2 as the tank drains. Active contacts stay full.
        // NB: apply to the INNER icon + callout, NOT the marker root — maplibre-gl
        // manages the root element's style.opacity itself (occlusion handling) and
        // resets it to 1 on every setLngLat() in moveMarker, so a root-level fade
        // silently reverted each poll. The inner nodes are ours alone.
        const fuelFrac = Math.max(0, Math.min(1, (a.fuelRemainingPercent ?? 0) / 100))
        const acOpacity = a.isActive ? '1' : String(0.2 + 0.3 * fuelFrac)
        entry.rot.style.opacity = acOpacity
        entry.callout.style.opacity = acOpacity

        // Record this fix and hand the marker to the prediction loop.
        //
        // Why not just tween: AIRCRAFT_TWEEN_MS is 900ms against a 3000ms poll, so the
        // old tween glided for under a second and then left the marker parked for the
        // remaining 2.1s. That pause is what reads as lag. Predicting from the fix each
        // frame removes the pause entirely: the marker travels at the aircraft's own
        // speed and track rather than hopping between poll results.
        entry.fix = {
          lat: pos.lat,
          lng: pos.lng,
          headingDeg: pos.hdg ?? null,
          groundSpeedKt: pos.spd ?? null,
          // Legacy trail points have no absolute time; the receive time is the honest
          // fallback (it underestimates the age slightly, which is the safe direction).
          ts: pos.ts ?? Date.now(),
        }
        entry.live = a.isActive === true
        if (entry.live && !scrubbing) {
          // Prediction owns the position now — a tween on top would fight it.
          if (entry.raf) { cancelAnimationFrame(entry.raf); entry.raf = null }
          entry.cur = target
          entry.marker.setLngLat(target)
        } else {
          moveMarker(entry, target, !scrubbing)
        }

        // Altitude drives the cone (feet in the feed, metres in the model), and the
        // heading rotates it. Stored here so the per-frame loop can re-size it on zoom
        // without waiting for the next poll.
        entry.altM = typeof a.altitude === 'number' && Number.isFinite(a.altitude)
          ? a.altitude * 0.3048
          : null
        entry.hdg = typeof pos.hdg === 'number' && Number.isFinite(pos.hdg)
          ? pos.hdg
          : (typeof a.heading === 'number' ? a.heading : 0)
        entry.role = a.role
      }
    }
    for (const [id, entry] of aircraftMarkers.current) {
      if (!live.has(id)) {
        if (entry.raf) cancelAnimationFrame(entry.raf)
        entry.marker.remove()
        aircraftMarkers.current.delete(id)
      }
    }

    // Trails — ONLY for the aircraft the operator has actually selected.
    // This used to draw every aircraft's full retained history, so breadcrumbs
    // appeared behind aircraft nobody had touched. On a map whose job is the
    // live picture that is clutter, and it reads as a claim about aircraft the
    // operator never asked about. The predictive vector below has always been
    // selection-scoped, so this makes the two behave the same way.
    const trailFeatures: GeoJSON.Feature[] = []
    if (layers.trails && selectedAircraftId) {
      const sel = aircraft.find((a) => a.id === selectedAircraftId)
      // The WHOLE retained trail, not a time window. A 30-min tail (2 h when
      // selected) vanished partway through a long patrol, which is what the
      // user actually sees as "the breadcrumb doesn't stay up for the flight".
      // The buffer is bounded per-sortie in the store instead
      // (appendTrackPoint / TRAIL_MAX_POINTS), so no window is needed here.
      const trail = sel ? sampleTrailUntil(sel.track, scrubT, Number.POSITIVE_INFINITY) : []
      if (trail.length >= 2) {
        trailFeatures.push({
          type: 'Feature',
          properties: { w: 3, o: 0.8 },
          geometry: { type: 'LineString', coordinates: trail.map((p) => [p.lng, p.lat]) },
        })
      }
    }
    setData(map, 'vp-trails', trailFeatures)

    // Predictive vector (selected aircraft, 60s ahead).
    const predictFeatures: GeoJSON.Feature[] = []
    if (layers.predictive && selectedAircraftId) {
      const sel = positions.find((p) => p.a.id === selectedAircraftId)
      if (sel?.pos) {
        const { lat, lng, hdg, spd } = sel.pos
        const hdgRad = ((hdg - 90) * Math.PI) / 180
        const fwd = spd * 0.514 * 60
        const dLat = (Math.cos(hdgRad) * fwd) / 111_000
        const dLng = (Math.sin(hdgRad) * fwd) / (111_000 * Math.cos((lat * Math.PI) / 180))
        predictFeatures.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[lng, lat], [lng + dLng, lat + dLat]] },
        })
      }
    }
    setData(map, 'vp-predict', predictFeatures)

    // Visible reports (respecting the scrubber).
    const visibleReports = reports.filter((r) => r.reportedAgo - scrubT >= 0)

    // Connection lines: aircraft to nearby reports within 5km.
    const connFeatures: GeoJSON.Feature[] = []
    for (const { pos } of positions) {
      if (!pos) continue
      for (const r of visibleReports) {
        const dist = computeDistance(pos.lat, pos.lng, r.lat, r.lng)
        if (dist < 5000) {
          connFeatures.push({
            type: 'Feature',
            properties: { o: Math.max(0.1, 1 - dist / 5000) * 0.4 },
            geometry: { type: 'LineString', coordinates: [[pos.lng, pos.lat], [r.lng, r.lat]] },
          })
        }
      }
    }
    setData(map, 'vp-conn', connFeatures)

    // Threat-density bins.
    const hexFeatures: GeoJSON.Feature[] = []
    if (visibleReports.length >= 3) {
      const HEX = 0.012
      const bins = new Map<string, { lat: number; lng: number; count: number }>()
      for (const r of visibleReports) {
        const col = Math.round(r.lng / (HEX * 1.5))
        const row = Math.round(r.lat / (HEX * Math.sqrt(3)))
        const key = `${col},${row}`
        const ex = bins.get(key)
        if (ex) ex.count++
        else bins.set(key, { lat: row * HEX * Math.sqrt(3), lng: col * HEX * 1.5, count: 1 })
      }
      for (const b of bins.values()) {
        if (b.count < 2) continue
        const f = circlePolygon(b.lng, b.lat, 600)
        f.properties = { o: Math.min(0.25, b.count * 0.08) }
        hexFeatures.push(f)
      }
    }
    setData(map, 'vp-hex', hexFeatures)
  }, [
    ready,
    aircraft,
    reports,
    scrubT,
    layers.aircraft,
    layers.trails,
    layers.predictive,
    selectedAircraftId,
    onSelectAircraft,
  ])

  // ── Report markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    const visible = layers.reports ? reports.filter((r) => r.reportedAgo - scrubT >= 0) : []
    const live = new Set<string>()

    for (const r of visible) {
      live.add(r.id)
      const isSel = r.id === selectedReportId
      // CONFIRMED ground threat → threat red; single-source Reported → softer green.
      const confirmed = r.nThumbsUp >= 5 && r.lastConfirmedAgo < 120
      // Unit kind colour: police units are red whether liveried or not, so
      // marked and unmarked share the threat colour. Cameras and concealed
      // contacts stay informational blue.
      const color = r.kind === 'marked' || r.kind === 'unmarked' ? RED : BLUE

      let marker = reportMarkers.current.get(r.id)
      if (!marker) {
        const el = document.createElement('div')
        el.className = 'vp-rp-marker'
        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([r.lng, r.lat])
          .addTo(map)
        reportMarkers.current.set(r.id, marker)
      }
      const el = marker.getElement() as HTMLDivElement
      const ageMin = Math.max(0, Math.round((r.reportedAgo - scrubT) / 60))
      const ageStr = ageMin < 1 ? '<1m' : ageMin < 60 ? `${ageMin}m` : '>1h'
      el.innerHTML =
        reportMarkerSVG(r.kind, color, 30) +
        `<div class="vp-rp-callout${confirmed ? ' confirmed' : ''}">` +
        `<span class="vp-co-kind">${r.kind.toUpperCase()}</span>` +
        `<span class="vp-co-age">${ageStr}</span>` +
        `<div class="vp-co-stem"></div></div>`
      el.classList.toggle('selected', isSel)
      // Police units get the blinking blue/red overglow — re-evaluated on every
      // data pass so the class cannot go stale if a kind's config changes.
      el.classList.toggle('vp-police', isGlowingKind(r.kind))
      el.onclick = () => onSelectReport(r.id)
      marker.setLngLat([r.lng, r.lat])
    }

    for (const [id, marker] of reportMarkers.current) {
      if (!live.has(id)) {
        marker.remove()
        reportMarkers.current.delete(id)
      }
    }
  }, [ready, reports, scrubT, layers.reports, selectedReportId, onSelectReport])

  // ── Community sighting dots (crowdsourced, Signal Blue, APPROX) ─────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    const live = new Set<string>()
    for (const dot of communityDots) {
      live.add(dot.aircraftHex)
      let marker = communityMarkers.current.get(dot.aircraftHex)
      if (!marker) {
        const el = document.createElement('div')
        el.className = 'vp-cdot-marker'
        el.innerHTML =
          '<div class="vp-cdot-pulse"></div>' +
          '<div class="vp-cdot-core"></div>' +
          `<div class="vp-cdot-label">${dot.aircraftHex} · APPROX</div>`
        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([dot.lng, dot.lat])
          .addTo(map)
        communityMarkers.current.set(dot.aircraftHex, marker)
      }
      marker.setLngLat([dot.lng, dot.lat])
    }

    for (const [id, marker] of communityMarkers.current) {
      if (!live.has(id)) {
        marker.remove()
        communityMarkers.current.delete(id)
      }
    }
  }, [ready, communityDots])

  // Continuous dead-reckoning between polls.
  //
  // Measured: the poll gap is 3000ms while AIRCRAFT_TWEEN_MS was 900ms, so each marker
  // glided for under a second and then sat parked for the remaining 2.1s. This loop
  // advances every LIVE marker from its last fix each frame instead, so motion is
  // continuous rather than stepped. It uses the honest deadReckon() helper, which
  // refuses to invent motion without a heading and speed, and caps its own extrapolation
  // at 30s; past AIRCRAFT_PREDICT_MAX_SEC the marker is left where it is and the app's
  // silent/stale styling takes over.
  //
  // Silent aircraft and scrubbed time are deliberately NOT predicted: a ghost must not
  // appear to keep flying, and during time-travel the position is a historical fact.
  useEffect(() => {
    if (!ready) return
    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      // scrubT !== 0 means time-travel: positions are historical facts then, not things
      // to predict forward from.
      if (scrubT !== 0) return
      const map = mapRef.current
      if (!map) return
      const now = Date.now()
      for (const entry of aircraftMarkers.current.values()) {
        updateVision(entry, map)
        if (!entry.live || !entry.fix) continue
        const ageSec = (now - entry.fix.ts) / 1000
        if (!(ageSec >= 0) || ageSec > AIRCRAFT_PREDICT_MAX_SEC) continue
        const p = deadReckon(
          {
            lat: entry.fix.lat,
            lng: entry.fix.lng,
            headingDeg: entry.fix.headingDeg,
            groundSpeedKt: entry.fix.groundSpeedKt,
          },
          ageSec,
        )
        // Skip sub-pixel churn: MapLibre re-projects on every setLngLat, and a parked
        // aircraft would otherwise be pushed through that 60 times a second for nothing.
        if (Math.abs(p.lng - entry.cur[0]) < 1e-6 && Math.abs(p.lat - entry.cur[1]) < 1e-6) continue
        entry.cur = [p.lng, p.lat]
        entry.marker.setLngLat(entry.cur)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [ready, scrubT])

  // Coverage boxes: operator-only, so on the public site the collection is empty and
  // nothing draws — the layer exists but has nothing in it.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setData(map, 'vp-coverage', coverage?.features ?? [])
  }, [ready, coverage])

  // Aircraft marker click handlers are bound here so they always see the
  // latest callback identity without recreating markers.
  useEffect(() => {
    if (!ready) return
    for (const [id, entry] of aircraftMarkers.current) {
      ;(entry.marker.getElement() as HTMLDivElement).onclick = () => onSelectAircraft(id)
    }
  }, [ready, aircraft, onSelectAircraft])

  // Degraded map area, not a dead page: say why the map is missing and let the
  // user retry, while the header, alerts and aircraft list keep working.
  if (initError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--map-bg)] px-8 text-center">
        <div className="text-red text-sm font-mono tracking-[0.1em]">MAP UNAVAILABLE</div>
        <div className="text-fg-3 text-xs font-mono max-w-sm leading-relaxed">{initError}</div>
        <div className="text-fg-4 text-xs font-mono max-w-sm leading-relaxed">
          The map needs WebGL. That is normally off because hardware acceleration is
          disabled, or because this page is open in a stripped-down browser. Alerts
          and aircraft are unaffected.
        </div>
        <button
          onClick={() => { setInitError(null); setRetryKey((k) => k + 1) }}
          className="px-4 py-2 rounded bg-ink-1 border border-border text-fg-2 text-xs font-mono hover:bg-ink-2 transition-colors cursor-pointer"
        >
          RETRY
        </button>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Pulsing amber edge glow when known aircraft are silent (off-ADS-B). */}
      {hasSilentAircraft && (
        <div
          className="absolute inset-0 pointer-events-none z-[1000]"
          style={{
            border: '2px solid var(--amber)',
            boxShadow: '0 0 12px var(--amber-glow), inset 0 0 12px var(--amber-glow)',
            animation: 'silent-pulse 3s ease-in-out infinite',
          }}
        />
      )}
    </div>
  )
}

/**
 * Can this client create a WebGL context? MapLibre throws without one, and on
 * browsers where it is blocked (hardware acceleration off, anti-detect browsers,
 * iOS Low Power Mode, in-app WebViews) that throw used to take down the page.
 */
function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

// Update a GeoJSON source's features.
// Idempotently (re)adds the imperatively-updated GeoJSON overlay sources and
// layers (threat density, aircraft→report connectors, trails, GPS accuracy
// disc, predictive vector). Called on initial map load AND after any setStyle()
// — a style swap drops all sources/layers, so they must be re-added.
function addVpOverlays(map: maplibregl.Map) {
  const addSrc = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
  }
  addSrc('vp-hex')
  addSrc('vp-conn')
  addSrc('vp-trails')
  addSrc('vp-acc')
  addSrc('vp-coverage')
  addSrc('vp-predict')

  // Aerodromes: a STATIC dataset (public/aerodromes.geojson, built from the
  // public-domain OurAirports data for Victoria — 225 strips, heliports
  // included). It cannot come from the basemap: the self-hosted PMTiles archive
  // stops at zoom 14 while the Protomaps style only labels aerodrome POIs from
  // zoom 17, so names could never draw, and its POI coverage is sparse anyway.
  if (!map.getSource('vp-aerodromes'))
    map.addSource('vp-aerodromes', {
      type: 'geojson',
      data: '/aerodromes.geojson',
      attribution: 'Aerodrome data: OurAirports (public domain)',
    })

  // Coverage boxes: the police areas this deployment actually pays WazeAPI to poll, each
  // labelled with its monthly cost, for deciding whether to buy more.
  //
  // OPERATOR-ONLY. The data comes from /api/coverage, which 404s for anything arriving
  // through the public tunnel — so on the live site this source stays empty and nothing
  // draws. The footprint of what we collect is not a public feature.
  if (!map.getLayer('vp-coverage-line'))
    map.addLayer({
      id: 'vp-coverage-line', type: 'line', source: 'vp-coverage',
      // Strengthened after the first version was too faint to spot without zooming in:
      // 1.1px at 0.7 opacity with short dashes disappeared against the basemap. Now a
      // longer dash, thicker, with a dark casing under it so the line reads over both the
      // light satellite basemap and the dark radar one.
      paint: {
        'line-color': '#EAF2F8',
        'line-width': 1.7,
        'line-opacity': 0.95,
        'line-dasharray': [4, 3],
      },
    })
  if (!map.getLayer('vp-coverage-casing'))
    map.addLayer({
      id: 'vp-coverage-casing', type: 'line', source: 'vp-coverage',
      paint: { 'line-color': '#04121C', 'line-width': 3.2, 'line-opacity': 0.55, 'line-dasharray': [4, 3] },
    }, 'vp-coverage-line')
  if (!map.getLayer('vp-coverage-label'))
    map.addLayer({
      id: 'vp-coverage-label', type: 'symbol', source: 'vp-coverage', minzoom: 7,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Noto Sans Medium'],
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#F1F5F8', 'text-halo-color': '#04121C', 'text-halo-width': 2 },
    })

  if (!map.getLayer('vp-hex-fill'))
    map.addLayer({ id: 'vp-hex-fill', type: 'fill', source: 'vp-hex', paint: { 'fill-color': RED, 'fill-opacity': ['get', 'o'] } })
  if (!map.getLayer('vp-hex-line'))
    map.addLayer({ id: 'vp-hex-line', type: 'line', source: 'vp-hex', paint: { 'line-color': RED, 'line-opacity': 0.3, 'line-width': 1, 'line-dasharray': [4, 4] } })
  if (!map.getLayer('vp-conn-line'))
    map.addLayer({ id: 'vp-conn-line', type: 'line', source: 'vp-conn', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#4D7CFF', 'line-width': 1, 'line-opacity': ['get', 'o'], 'line-dasharray': [3, 6] } })
  if (!map.getLayer('vp-trails-line'))
    map.addLayer({ id: 'vp-trails-line', type: 'line', source: 'vp-trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fcee0a', 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'] } })
  if (!map.getLayer('vp-acc-fill'))
    map.addLayer({ id: 'vp-acc-fill', type: 'fill', source: 'vp-acc', paint: { 'fill-color': '#4D7CFF', 'fill-opacity': 0.12 } })
  if (!map.getLayer('vp-acc-line'))
    map.addLayer({ id: 'vp-acc-line', type: 'line', source: 'vp-acc', paint: { 'line-color': '#4D7CFF', 'line-width': 1, 'line-opacity': 0.4 } })
  if (!map.getLayer('vp-predict-line'))
    map.addLayer({ id: 'vp-predict-line', type: 'line', source: 'vp-predict', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#00d4ff', 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [8, 6] } })

  // ── Aerodromes: a dot per field, plus names ────────────────────────────────
  // Deliberately NOT amber or red: those are semantic here (MLAT/silent, fuel,
  // threat). An aerodrome is infrastructure, so it takes a cool white that
  // reads as "place" while staying distinct from the cyan basemap labels.
  if (!map.getLayer('vp-aerodrome-dot'))
    map.addLayer({
      id: 'vp-aerodrome-dot',
      type: 'circle',
      source: 'vp-aerodromes',
      minzoom: 8,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.8, 11, 3, 14, 4],
        'circle-color': '#CFE4F2',
        'circle-opacity': 0.8,
        'circle-stroke-color': '#03070C',
        'circle-stroke-width': 1,
      },
    })

  // Two label layers instead of one filtered by zoom: a rank-based minzoom is
  // what stops 179 small strips from competing with YMML at low zoom, and
  // symbol-sort-key makes the significant fields win the collisions that remain.
  // Large/medium carry the ICAO ident on a second line, which is how an operator
  // reads a strip out of the aircraft feed.
  if (!map.getLayer('vp-aerodrome-label'))
    map.addLayer({
      id: 'vp-aerodrome-label',
      type: 'symbol',
      source: 'vp-aerodromes',
      minzoom: 8,
      filter: ['<=', ['get', 'rank'], 2],
      layout: {
        'symbol-sort-key': ['get', 'rank'],
        'text-font': ['Noto Sans Medium'],
        'text-field': ['concat', ['get', 'name'], '\n', ['get', 'ident']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10.5, 11, 12, 14, 13.5],
        'text-anchor': 'top',
        'text-offset': [0, 0.55],
        'text-max-width': 10,
        'text-padding': 3,
      },
      paint: {
        'text-color': '#DCEBF5',
        'text-halo-color': '#03070C',
        'text-halo-width': 1.2,
      },
    })

  if (!map.getLayer('vp-aerodrome-label-small'))
    map.addLayer({
      id: 'vp-aerodrome-label-small',
      type: 'symbol',
      source: 'vp-aerodromes',
      minzoom: 11,
      filter: ['>=', ['get', 'rank'], 3],
      layout: {
        'symbol-sort-key': ['get', 'rank'],
        'text-font': ['Noto Sans Regular'],
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12],
        'text-anchor': 'top',
        'text-offset': [0, 0.55],
        'text-max-width': 9,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#9FBCCD',
        'text-halo-color': '#03070C',
        'text-halo-width': 1.1,
      },
    })
}

// Toggle the (dimmed) Esri satellite underlay based on where the map is looking.
// The self-hosted vector basemap only covers Greater Melbourne, so when the view
// centre leaves that box we reveal the raster and drop the opaque vector
// background so the satellite fills the otherwise-black void; back inside
// coverage we hide it again → pure radar, no external tiles. No-ops in satellite
// mode (no vector source there — Esri is the whole basemap and must stay shown).
function applySatFallback(map: maplibregl.Map) {
  try {
    if (!map.getLayer('esri-imagery')) return
    const sources = map.getStyle()?.sources || {}
    const hasVector = Object.values(sources).some((s: any) => s?.type === 'vector')
    if (!hasVector) return // satellite mode — leave the imagery as the base
    const c = map.getCenter()
    const off = outsideCoverage(c.lng, c.lat)
    map.setLayoutProperty('esri-imagery', 'visibility', off ? 'visible' : 'none')
    // Drop the opaque vector background when off-coverage so the satellite shows
    // through the void; restore it inside coverage. Found by type (the flavor's
    // background layer id isn't guaranteed).
    const bg = (map.getStyle()?.layers || []).find((l: any) => l.type === 'background') as any
    if (bg?.id) map.setPaintProperty(bg.id, 'background-opacity', off ? 0 : 1)
  } catch { /* style mid-swap — a later moveend/styledata re-applies */ }
}

function setData(map: maplibregl.Map, id: string, features: GeoJSON.Feature[]) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  src?.setData({ type: 'FeatureCollection', features })
}

/**
 * Size and rotate an aircraft's forward-visibility cone.
 *
 * The cone is a MODEL (see lib/pilot-vision.ts): it grows with altitude until 20/20 acuity
 * limits what can be detected, then NARROWS as the blind area beneath the aircraft eats
 * into that fixed usable range, and disappears above the altitude where the band closes.
 * Sizing is in pixels from the map's current ground resolution, so the cone means the same
 * physical thing at every zoom, and it is rotated to the aircraft's heading for BOTH kinds
 * — the rotary glyph deliberately does not rotate, but where a crew is looking is not a
 * property of the glyph.
 *
 * A silent aircraft gets no cone. A ghost has no forward view worth showing, and drawing
 * one would assert a live observer we cannot see.
 */
function updateVision(entry: AircraftMarkerEntry, map: maplibregl.Map) {
  const el = entry.vision
  if (!el) return
  el.style.transform = `rotate(${entry.hdg || 0}deg)`

  const clear = (key: string) => {
    if (entry.coneKey !== key) { el.innerHTML = ''; entry.coneKey = key }
  }
  if (!entry.live || entry.altM === null) return clear('none')

  // The role changes the model, not just the glyph: a hovering helicopter looks down more
  // steeply and scans wider than a fixed wing that must keep flying forward.
  const cone = visionConeForAltitude(entry.altM, { role: entry.role })
  if (!cone) return clear(`closed-${entry.role}`)

  const centre = map.getCenter()
  const mpp = metresPerPixel(map.getZoom(), centre.lat)
  const key = `${entry.role}:${Math.round(cone.nearM)}:${Math.round(cone.farM)}:${mpp.toFixed(2)}`
  if (key === entry.coneKey) return
  entry.coneKey = key
  el.innerHTML = visionConeSVG(cone, mpp, { idSuffix: entry.markerId })
}

// Move an aircraft marker, optionally tweening from its current visual
// position (live polls interpolate; scrubbing snaps).
function moveMarker(entry: AircraftMarkerEntry, to: [number, number], animate: boolean) {
  if (entry.raf) {
    cancelAnimationFrame(entry.raf)
    entry.raf = null
  }
  if (!animate || (entry.cur[0] === to[0] && entry.cur[1] === to[1])) {
    entry.cur = to
    entry.marker.setLngLat(to)
    return
  }
  const from: [number, number] = [entry.cur[0], entry.cur[1]]
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / AIRCRAFT_TWEEN_MS)
    const e = 1 - Math.pow(1 - t, 3) // easeOutCubic
    const lng = from[0] + (to[0] - from[0]) * e
    const lat = from[1] + (to[1] - from[1]) * e
    entry.cur = [lng, lat]
    entry.marker.setLngLat([lng, lat])
    if (t < 1) entry.raf = requestAnimationFrame(step)
    else {
      entry.cur = to
      entry.raf = null
    }
  }
  entry.raf = requestAnimationFrame(step)
}
