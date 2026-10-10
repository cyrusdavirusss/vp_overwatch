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
import { buildMapStyle, registerPmtilesProtocol, outsideCoverage, TERRAIN_SOURCE_ID, type MapViewType } from '@/lib/map-style'
import type { CommunityDot } from '@/lib/visual-sighting'
import { aircraftMarkerSVG, reportMarkerSVG, isGlowingKind, ghostMarkerSVG, ghostModelFor, RED, BLUE, type AircraftView } from '@/lib/markers'
import type { Aircraft3DView, Aircraft3DRole } from '@/lib/aircraft-3d'
import { deadReckon } from '@/lib/geo/dead-reckoning'
import {
  visionConeForAltitude,
  visionConeSVG,
  metresPerPixel,
  EOIR_ZOOM_ESTIMATE,
  MAX_SENSOR_RANGE_M,
} from '@/lib/pilot-vision'
import { estimateSensorPointing, type PointingEstimate } from '@/lib/sensor-pointing'
import { zoomInByPercentCapped } from '@/lib/zoom'

// Register the pmtiles:// protocol once, at the map module root. This module
// is only ever loaded client-side (via the lazy map loader), so it is safe to
// run at evaluation time; the call is idempotent.
registerPmtilesProtocol()

export interface VPMapProps {
  aircraft: Aircraft[]
  reports: Report[]
  user: User
  /**
   * Whether `user` is a REAL fix from this visitor's own device.
   *
   * `user` always carries a point, because the caller falls back to the default
   * map centre when there is no fix — so the map cannot tell a real position from
   * a placeholder by looking at it. It used to draw a pulsing "you are here" dot
   * and an accuracy disc at that fallback for every visitor whose browser gave no
   * position, i.e. it asserted a location it did not have. The marker is gated on
   * this flag instead. Defaults to true: a caller that omits it keeps the dot.
   */
  hasUserFix?: boolean
  selectedAircraftId: string | null
  selectedReportId: string | null
  /**
   * Overwatch mode: the ground report to orbit, or null for the normal view.
   *
   * Passed as an ID rather than a coordinate so the orbit follows the report's
   * live position and so the map can choose the hollow model from the report's
   * own `kind` — a caller cannot silently stand a police car on a speed camera.
   */
  overwatchReportId?: string | null
  /**
   * Overwatch targeting an AIRCRAFT instead of a ground report. Same satellite basemap and
   * pitch, but the camera holds a FIXED bearing and follows the contact as it travels — there
   * is no orbit, because the subject is already moving.
   */
  overwatchAircraftId?: string | null
  /**
   * Hold the aircraft tracking view on the OPERATOR's own position instead of the contact.
   * Bearing, pitch and zoom are untouched — only the point under the camera changes, so it is
   * the same view pointed at a different piece of ground.
   */
  overwatchUserView?: boolean
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
  /**
   * A tap on the map. `accuracyM` is how coarse that tap was — derived from the zoom
   * it was made at, because a finger on a half-state view covers kilometres and a
   * sighting placed that way must not be served as a precise position.
   */
  onMapClick?: (lat: number, lng: number, accuracyM?: number) => void
  /**
   * Out-of-sight sighting pick: on change, fly to this point at a zoom that
   * frames `rangeM` metres of radius on screen so the operator can tap the
   * exact spot they saw the contact from. Callers must keep the object
   * reference stable (state, not a fresh literal each render) or the camera
   * will keep re-flying.
   */
  pickTarget?: { lat: number; lng: number; rangeM: number; scopeAreaM2?: number } | null
  /**
   * Hold the map north-up and refuse rotation. Used by the stealth-helicopter mode:
   * the operator is judging where an aircraft is against the ground, and a rotated
   * map turns "north-west of me" into a guess.
   */
  northLock?: boolean
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

// ── Overwatch ───────────────────────────────────────────────────────────────
/** Degrees of bearing per second the Overwatch camera sweeps around its mark.
 *  Deliberately slow: this is a viewing motion for reading the ground a report
 *  sits on, not a search pattern, and a faster spin is unwatchable for more than
 *  a few seconds. A full circle takes a minute. */
const OVERWATCH_ORBIT_DPS = 6
/** Tilt of the Overwatch camera. Steep enough to read the ground the model
 *  stands on, shallow enough that the ghost still reads as a standing object
 *  rather than a plan view. */
const OVERWATCH_PITCH = 58
/**
 * Pitch for the AIRCRAFT tracking view — much closer to the horizon than the ground orbit's.
 *
 * Orbiting a ground unit is a SURVEY: you want to look down at the ground around it. Tracking an
 * aircraft is a CHASE: the point is to see it against the horizon and read where it is going, so
 * the camera comes down to roughly the contact's own horizon rather than hovering overhead.
 *
 * MapLibre clamps pitch at 60 by default, so the map is created with a raised cap — without that
 * this value would silently clamp and the view would stay close to top-down, which is exactly the
 * "it cant just be birdseye" complaint.
 */
const OVERWATCH_TRACK_PITCH = 78
/**
 * The tilt the map opens at, and the tilt it returns to. ZERO — deliberately.
 *
 * This was briefly 50 in an attempt to answer "make the world more 3d", and that was the wrong
 * lever: a whole-map tilt changes how every pin, street and report reads, and the correction was
 * "u added a tilt to the whole map i only wanted the terain to look more 3d ... keep it to
 * overwatch button". So the ordinary map stays flat and TILT BELONGS TO OVERWATCH ALONE
 * (OVERWATCH_ORBIT_PITCH for ground contacts, OVERWATCH_TRACK_PITCH for aircraft).
 *
 * What "3D terrain" actually requires, recorded here so the next attempt does not repeat the
 * mistake: relief is only VISIBLE when the camera is tilted, so a dem source without a tilt shows
 * nothing, and a tilt without a dem shows the same flat ground from an angle. Real ground relief
 * needs BOTH — a raster-dem source plus map.setTerrain() — and that is a separate decision from
 * this constant.
 */
const DEFAULT_PITCH = 0
/** Close enough that the ghost is the subject of the frame, not a detail on it. */
const OVERWATCH_ZOOM = 16.5

/**
 * Vertical exaggeration for the Overwatch terrain.
 *
 * 1.0 is true scale, and true scale is very nearly INVISIBLE over Greater
 * Melbourne — the relief around the city is gentle, so at Overwatch zoom a true
 * surface is indistinguishable from the flat one it replaces, which would make
 * this feature look broken rather than subtle. It is nudged up instead, and only
 * modestly: past roughly 1.6 the ground stops reading as ground and starts reading
 * as a cartoon, which is worse than flat because it misleads about slope.
 */
const OVERWATCH_TERRAIN_EXAGGERATION = 1.4

/**
 * Attach or detach the 3D terrain.
 *
 * THE DECISION THIS ENCODES, recorded because it was reached the hard way: relief
 * is only VISIBLE when the camera is tilted, and a tilt changes how every pin,
 * street and report on the map reads. So neither the tilt nor the terrain belongs
 * to the ordinary map — DEFAULT_PITCH stays 0, and the terrain is attached ONLY
 * while an Overwatch view is open, which is the one mode already deliberately
 * tilted (OVERWATCH_PITCH for ground contacts, OVERWATCH_TRACK_PITCH for aircraft).
 * Terrain in the flat map would be a no-op; a tilted flat map was the original
 * mistake ("u added a tilt to the whole map i only wanted the terain to look more
 * 3d ... keep it to overwatch button").
 *
 * Guarded on the source existing, and wrapped: setTerrain() against a source the
 * style does not contain THROWS, and an uncaught throw here escapes to Next's
 * error boundary and takes the whole page down, not just the map. A style swap is
 * exactly when the source is briefly absent, so this is the normal path, not an
 * edge case.
 */
function applyTerrain(map: maplibregl.Map, on: boolean): void {
  try {
    if (!map.getSource(TERRAIN_SOURCE_ID)) return
    map.setTerrain(
      on
        ? { source: TERRAIN_SOURCE_ID, exaggeration: OVERWATCH_TERRAIN_EXAGGERATION }
        : null,
    )
  } catch {
    /* style mid-swap — the styledata re-assert below retries */
  }
}
/**
 * Zoom for the AIRCRAFT tracking view — now the SAME street-level 16.5 as the ground orbit.
 *
 * It started at 14 and the verdict on it was "its too zoomed out get in way closer", so it now
 * comes in as far as the ground view does. Fixed wing is framed two levels further out than this
 * (see the tracking effect), because a plane crosses the state while a helicopter works locally.
 */
const OVERWATCH_AIRCRAFT_ZOOM = 17
/**
 * Size the aircraft glyph is drawn at while the tracking view is open.
 *
 * 36 is the map's normal marker size and it is too small for the tracking view's close zoom:
 * rendered to a review sheet at 36 and 44 px, both silhouettes collapsed into blobs (rotor,
 * boom and skids merging), became clearly readable at 52, and unambiguous at 60. This is the
 * "make the helicopter bigger" half of the request — it is a legibility requirement for the
 * side view, not a preference. The marker box grows with it (`.vp-ac-marker--tracking`).
 */
const AIRCRAFT_TRACKING_SIZE = 60
const AIRCRAFT_TWEEN_MS = 900

/**
 * How long a marker takes to absorb the difference between where it was being predicted
 * and a fix that has just arrived.
 *
 * Markers used to SNAP to every new fix, which is where "it sits still and then jumps all
 * over the place" came from: each fix carries an error — the aircraft turned while the
 * position was in flight, and the feed's own position is often seconds old even when it
 * arrives (seen_pos medians 0.3 s but a 90th percentile of 26 s in the live feed) — and a
 * snap draws every one of those errors as a discontinuity. Gliding over this window keeps
 * the drawn path continuous and still lands exactly on the fix.
 */
const FIX_SETTLE_MS = 1_200

/**
 * A correction larger than this is a genuine discontinuity — a bad fix, or a contact
 * reappearing after a long gap — not prediction error. Gliding across it would draw a
 * streak, so it snaps and the app's own stale/silent styling says what happened.
 * 0.05° is about 5.5 km of latitude.
 */
const FIX_SETTLE_MAX_DEG = 0.05

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

// A fingertip is worth about 22 px on any touch screen (Apple's own hit-target floor is
// 44 px across, so ~22 is its radius). Used to turn the map's ground resolution at the
// moment of a tap into metres of placement error.
const TAP_PX = 22

function zoomForRadius(rangeM: number, lat: number, el: HTMLElement | null): number {
  const w = el?.clientWidth || 360
  const h = el?.clientHeight || 640
  const halfAxisPx = Math.max(1, Math.min(w, h) / 2)
  const mPerPx = rangeM / halfAxisPx
  const z = Math.log2((WORLD_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / mPerPx)
  return Math.max(PICK_MIN_ZOOM, Math.min(PICK_MAX_ZOOM, z))
}

/**
 * The zoom whose visible ground AREA is `areaM2`, for this viewport.
 *
 * zoomForRadius cannot express "show me half the state", and the failure is instructive:
 * that framing fits a radius to the SHORTER axis, so on a portrait phone a radius that
 * looks right across the width still shows far more ground vertically. Asked for half of
 * Victoria that way, the map produced the whole state, Bass Strait and a slice of
 * Tasmania — about 1.4x the state's area, i.e. more than all of it.
 *
 * Area is the honest unit for "how much of the state am I looking at", so the wide scope
 * is stated in square metres and converted here against the real viewport.
 */
const SCOPE_MIN_ZOOM = 3
const SCOPE_MAX_ZOOM = 19

function zoomForArea(areaM2: number, lat: number, el: HTMLElement | null): number {
  const w = Math.max(1, el?.clientWidth || 360)
  const h = Math.max(1, el?.clientHeight || 640)
  const mPerPx = Math.sqrt(areaM2 / (w * h))
  const z = Math.log2((WORLD_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / mPerPx)
  return Math.max(SCOPE_MIN_ZOOM, Math.min(SCOPE_MAX_ZOOM, z))
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
  /**
   * Where the marker was DRAWN when the current fix arrived, and when it arrived. The gap
   * between that and the new fix glides away over FIX_SETTLE_MS instead of being snapped.
   */
  settle: { lat: number; lng: number; atMs: number; glide: boolean } | null
  /** Heading as DRAWN, and where its glide started, so the body turns instead of twitching. */
  hdgShown: number
  hdgFrom: number
  /** The forward-visibility cone: rotated with heading, sized from altitude and zoom. */
  vision: HTMLDivElement | null
  /** Key of the cone currently drawn, so an unchanged cone is not rebuilt every frame. */
  coneKey: string
  /**
   * Where the sensor is inferred to be looking. The turret slews independently of the
   * nose, so the cone must not be pinned to heading — see lib/sensor-pointing.ts.
   */
  pointing: PointingEstimate | null
  /** Altitude in metres (the source is feet) and heading, for the cone. */
  altM: number | null
  hdg: number
  /** The airframe's role, because the two roles see differently (lib/pilot-vision.ts). */
  role: Aircraft['role']
  /** Stable id used to keep this marker's cone gradient unique on the map. */
  markerId: string
  /**
   * Which glyph is currently rendered — `view:role:size`. Guards the innerHTML swap so
   * a poll cannot re-parse the SVG and restart the rotor animation (same pattern the
   * ghost marker uses), and lets the tracking view swap to the side elevation.
   */
  glyphKey: string
}

export function VPMap({
  aircraft,
  reports,
  user,
  hasUserFix = true,
  selectedAircraftId,
  selectedReportId,
  overwatchReportId = null,
  overwatchAircraftId = null,
  overwatchUserView = false,
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
  northLock,
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

    // North-up hold: rotation is REFUSED and the bearing pinned to 0, rather than the
    // free case below where it is enabled and merely reset. Held, not just reset — the
    // point of the mode is that a sighting is placed against a known orientation.
    if (northLock && !headingMode) {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      if (Math.abs(map.getBearing()) > 0.2) map.setBearing(0)
      return
    }

    // ── Overwatch is the ONE mode that turns the map on purpose ──────────────
    // The north-up hold below would fight it silently. Every setBearing fires a
    // `rotate` event, pinNorth snaps the bearing straight back to 0, and the orbit
    // becomes a no-op — measured: the loop ran at 50fps and the bearing never left
    // 0. Worse, that snap IS a camera command, so it also CANCELS the in-flight
    // Overwatch easeTo: the centre arrived while the pitch stalled at 1.2° instead
    // of the intended 58° and the zoom never moved. Rotation is therefore handed to
    // the orbit for as long as Overwatch is up, and the hold returns when it closes.
    if ((overwatchReportId || overwatchAircraftId) && !northLock && !headingMode) {
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
      return
    }

    // North-up, full stop — this is the DEFAULT state, and it used to be the one state
    // where the gesture was left enabled. A two-finger twist turned the map and left it
    // turned, taking every aircraft icon and its forward-vision cone with it: an operator
    // who pinched to zoom with a thumb resting on the glass got a rotated tactical picture
    // and no way to tell it had happened, because the HUD carries no bearing read-out.
    // Rotation is now refused here for the same reason head-up refuses it, and the bearing
    // is HELD rather than reset once, so nothing can leave it off north.
    if (!headingMode) {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      const pinNorth = () => {
        if (Math.abs(map.getBearing()) > 0.2) map.setBearing(0)
      }
      pinNorth()
      map.on('rotate', pinNorth)
      return () => map.off('rotate', pinNorth)
    }

    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.touchPitch?.disable?.()

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
      // Deliberately no re-enable: leaving head-up returns to north-up, it does not return
      // to a map the user can twist by accident.
    }
  }, [headingMode, headingRef, northLock, ready, overwatchReportId, overwatchAircraftId])
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
        // With NO client fix, `user` is the configured home point — NOT the operator.
        // Opening there at street zoom put the map on a place the operator never was and
        // let them read it as their own position, which is the confusion this app must not
        // create. With no fix, open wide over the coverage area instead; the "you are here"
        // dot is already hidden when hasUserFix is false, so nothing claims to know.
        center: [user.lng, user.lat],
        zoom: hasUserFix ? 9 : 7,
        pitch: DEFAULT_PITCH, // opens tilted so the ground reads as ground, not as a diagram
        bearing: 0,
        attributionControl: false,
        dragRotate: true,
        pitchWithRotate: true,
        // Default cap is 60, which is not shallow enough for the aircraft chase view to reach the
        // horizon (OVERWATCH_TRACK_PITCH is 74). Without raising it the tilt silently clamps and
        // the chase view stays near top-down.
        maxPitch: 85,
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
      // How coarse is this tap? MapLibre's ground resolution is
      //   metres/px = 78271.5 * cos(lat) / 2^zoom
      // so at the half-state zoom a fingertip spans kilometres. Handing that number up
      // means a wide-view sighting is published as approximate instead of being drawn
      // as though it were placed to the metre.
      const mPerPx =
        (WORLD_M_PER_PX_Z0 * Math.cos((e.lngLat.lat * Math.PI) / 180)) / Math.pow(2, map.getZoom())
      onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng, mPerPx * TAP_PX)
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
      // Hidden on creation when this visitor has no position of their own, so the
      // placeholder centre is never drawn as a marker even for one frame. The
      // marker effect shows it as soon as a real fix arrives.
      if (!hasUserFix) uel.style.display = 'none'
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
  const lastPickKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !pickTarget) { lastPickKeyRef.current = null; return }
    // A target with neither an area nor a radius asks for NO framing: the operator places
    // the sighting from the view they already have. Returning here is the difference
    // between "zoom in and place it" and being pulled out to a state-wide view.
    if (!pickTarget.scopeAreaM2 && !(pickTarget.rangeM > 0)) return
    // Fly ONCE per placement target. Callers used to hand down a fresh object every GPS
    // tick, which re-ran this effect and pulled the operator back to the wide view while
    // they were trying to zoom in and place the sighting. Keyed on the target's meaning,
    // so an identical re-arm is ignored and a genuinely new one still flies.
    const key = [
      pickTarget.lat.toFixed(6), pickTarget.lng.toFixed(6),
      pickTarget.rangeM, pickTarget.scopeAreaM2 ?? '',
    ].join(':')
    if (lastPickKeyRef.current === key) return
    lastPickKeyRef.current = key
    // Two framings, because they answer different questions. A unit is placed against a
    // radius ("show me 70 m"), which zoomForRadius clamps to a street-scale band so a
    // mis-tap costs a street number rather than a suburb. The helicopter sighting asks a
    // different question — how much of the state is on screen — so it is framed by area.
    const zoom = pickTarget.scopeAreaM2
      ? zoomForArea(pickTarget.scopeAreaM2, pickTarget.lat, map.getContainer())
      : zoomForRadius(pickTarget.rangeM, pickTarget.lat, map.getContainer())
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
    // No fix means no dot. `user` is a fallback centre when this visitor's device
    // has not given a position, and drawing a pulsing "you are here" marker at a
    // fallback asserts a location the app does not have.
    const el = userMarker.current?.getElement()
    if (el) el.style.display = hasUserFix ? '' : 'none'
    const src = map.getSource('vp-acc') as maplibregl.GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: hasUserFix && user.accuracy > 0
        ? [circlePolygon(user.lng, user.lat, user.accuracy)]
        : [],
    })
  }, [ready, hasUserFix, user.lat, user.lng, user.accuracy])

  /**
   * Keep the aircraft callout UPRIGHT while its marker rotates.
   *
   * The callout is deliberately a child of the marker element — it has to be, so it stays anchored
   * to the glyph — but that marker is map-rotation-aligned so the aircraft keeps its heading in the
   * tracking view, and the callout inherited that rotation and went sideways. Measured: a 56x185px
   * label box, text running vertically, and an effective rotation of -97.6deg, directly
   * contradicting the CSS comment that it "never rotates".
   *
   * Counter-rotating by the map's bearing cancels it exactly. Driven by the map's own 'rotate'
   * event rather than a frame loop, so it is correct in the tracking view, in the rotating ground
   * orbit and under a manual twist alike, and costs nothing while the map is north-up.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const apply = () => {
      map.getContainer().style.setProperty('--vp-callout-yaw', `${map.getBearing()}deg`)
    }
    apply()
    map.on('rotate', apply)
    return () => {
      map.off('rotate', apply)
    }
  }, [ready])

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
          // rotationAlignment 'map' is LOAD-BEARING for the aircraft tracking view, and this was
          // the bug behind "the heli followed the tilt and tilted with the tilt".
          //
          // MapLibre's default leaves markers VIEWPORT-aligned: they do not inherit the map's
          // bearing. In the normal north-up view that is indistinguishable from 'map', which is why
          // it went unnoticed for so long. But the tracking view rotates the map to the contact's
          // heading, and under viewport alignment the icon does not come along — so the helicopter
          // kept pointing east on screen while the map had east pointing up the screen. It flew
          // sideways.
          //
          // With 'map', the icon's own heading rotation and the map's bearing are applied in the
          // same space, so in the tracking view they cancel exactly and the nose sits up the
          // screen. In the normal view the bearing is 0 and nothing changes.
          const marker = new maplibregl.Marker({
            element: el,
            anchor: 'center',
            rotationAlignment: 'map',
            // 'viewport' is NOT optional here, and leaving it out caused the "the heli followed the
            // tilt and tilted with the tilt" report.
            //
            // MapLibre derives _pitchAlignment from _rotationAlignment when pitchAlignment is 'auto',
            // so setting rotationAlignment 'map' alone ALSO pitch-aligns the glyph: it laid the
            // marker flat into the ground plane with rotateX(pitch). Measured at pitch 78 the marker
            // transform was `rotateX(78deg) rotateZ(-97.56deg)` — a squashed top-down helicopter
            // lying on the tilted ground, still reading as birdseye however far the camera tilted.
            //
            // 'viewport' keeps the glyph SCREEN-facing while it still inherits the bearing, so the
            // nose maths works and the aircraft looks like an aircraft.
            pitchAlignment: 'viewport',
          })
            .setLngLat(target)
            .addTo(map)
          const hdg0 = Number.isFinite(pos.hdg) ? pos.hdg : 0
          rot.style.transform = `rotate(${hdg0}deg)`
          entry = {
            marker, rot, callout, cur: target, raf: null, fix: null, live: false,
            settle: null, hdgShown: hdg0, hdgFrom: hdg0,
            vision, coneKey: '', pointing: null, altM: null, hdg: hdg0, role: a.role, markerId: a.id,
            glyphKey: `top:${a.role}:36`,
          }
          aircraftMarkers.current.set(a.id, entry)
        }

        // ── Glyph: the tracking view draws a SIDE ELEVATION, larger ───────────────
        // A plan-view glyph cannot show a side view however the camera is aimed, because
        // `pitchAlignment: 'viewport'` keeps it screen-facing — and a top-down silhouette under an
        // abeam camera still reads as birdseye, which is the complaint this answers. So the
        // tracking view swaps in the side-profile art from lib/markers.ts.
        //
        // It is also bigger: on the review sheet the icon collapsed into an unreadable blob at the
        // map's normal 36px, so a tracked contact gets AIRCRAFT_TRACKING_SIZE.
        //
        // The art is drawn nose-LEFT, which is why the camera's SIDE_DEG is +90 rather than -90 —
        // the two must agree, or the aircraft appears to fly backwards along its own trail. See
        // the bearing block for the derivation.
        //
        // Keyed rather than applied unconditionally, for the same reason the Overwatch ghost
        // marker is keyed: this effect re-runs on every feed poll, and re-assigning innerHTML
        // re-parses the SVG and RESTARTS the rotor animation at the poll cadence.
        const tracking = a.id === overwatchAircraftId
        // Which art the tracking view needs is decided by the CAMERA, and the camera is no
        // longer the same for both roles: a helicopter is still watched ABEAM, so it keeps the
        // side elevation, while a fixed wing is now CHASED FROM BEHIND — and from behind, the
        // honest silhouette is the ordinary top-down one, nose up the screen. Using the side
        // art under a chase camera would draw the aircraft broadside while it flew away.
        const trackingView: AircraftView = 'top'
        const glyphKey = `${trackingView}:${a.role}:${tracking ? AIRCRAFT_TRACKING_SIZE : 36}`
        if (entry.glyphKey !== glyphKey) {
          entry.glyphKey = glyphKey
          entry.rot.innerHTML = aircraftMarkerSVG(
            a.role,
            tracking ? AIRCRAFT_TRACKING_SIZE : 36,
            trackingView
          )
          entry.marker.getElement().classList.toggle('vp-ac-marker--tracking', tracking)
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
        // The body follows the heading — but through the same glide as the position.
        // A fix can honestly carry a heading 30–90° away from the previous one after a
        // gap, and assigning it directly turns that into a twitch. Scrubbed and silent
        // contacts are set outright: the glide only runs while the prediction loop is
        // running, so a scrubbed view must never be left mid-turn.
        const isLive = a.isActive === true
        // EVERY airframe's nose follows its heading, rotary included.
        //
        // An earlier pass pinned helicopters upright, reading "no rotation" in the rotational
        // view as being about the ICON. It was not — that meant the CAMERA must not orbit. The
        // pin left a helicopter flying east with its nose locked north, which reads as broken:
        // which way a contact is pointing is the first thing an operator checks.
        //
        // The glide below is what stops it twitching, and that is now sufficient: heading arrives
        // dead-reckoned and continuous, so following it no longer jumps 30-90 degrees per poll.
        if (isLive && !scrubbing) {
          entry.hdgFrom = entry.hdgShown
        } else {
          const shown = Number.isFinite(pos.hdg) ? pos.hdg : entry.hdgShown
          entry.hdgShown = shown
          entry.hdgFrom = shown
          entry.rot.style.transform = `rotate(${shown}deg)`
        }
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
        entry.live = isLive
        if (entry.live && !scrubbing) {
          // Prediction owns the position now — a tween on top would fight it. So hand the
          // marker a CORRECTION rather than teleporting it. This is the line that used to
          // SNAP the marker to every fix, which is what made a late or slightly-wrong fix
          // land as a visible jump; the gap between where the prediction had drawn the
          // aircraft and the fix itself is now glided away by the frame loop.
          if (entry.raf) { cancelAnimationFrame(entry.raf); entry.raf = null }
          const dLat = entry.cur[1] - target[1]
          const dLng = entry.cur[0] - target[0]
          entry.settle = {
            lat: entry.cur[1],
            lng: entry.cur[0],
            atMs: Date.now(),
            // A bigger correction than this is a genuine discontinuity (a bad fix, or a
            // contact back after a long gap), not prediction error: gliding across it
            // would draw a streak, so it snaps and the stale/silent styling says why.
            glide: Math.abs(dLat) <= FIX_SETTLE_MAX_DEG && Math.abs(dLng) <= FIX_SETTLE_MAX_DEG,
          }
        } else {
          entry.settle = null
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
        // Infer where the camera is pointed. ADS-B never carries the turret angle, so this
        // is an inference with an uncertainty, and the cone is drawn as wide as the
        // uncertainty and in a duller colour when there is no basis for it.
        const reach = typeof entry.altM === 'number' && entry.altM > 0
          ? Math.min(MAX_SENSOR_RANGE_M, Math.max(2000, entry.altM * 12))
          : MAX_SENSOR_RANGE_M
        entry.pointing = estimateSensorPointing({
          track: Array.isArray(a.track) ? a.track : [],
          headingDeg: entry.hdg,
          groundSpeedKt: typeof a.speed === 'number' ? a.speed : null,
          contacts: reports.map((r) => ({ lat: r.lat, lng: r.lng })),
          reachM: reach,
        })
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
      // CARRY THE TRAIL'S HEAD TO WHERE THE MARKER IS DRAWN.
      //
      // The trail is raw fixes, but the marker is dead-reckoned forward from its last fix —
      // measured ~1141 m ahead at the current poll cadence — so the breadcrumb met the
      // aircraft in a visible kink instead of under it. This is the repo's own open item, and
      // one point fixes it: the same point the arrow is drawn at, so the two cannot disagree.
      //
      // Skipped while scrubbing, where the marker is deliberately showing a HISTORICAL
      // position and the trail is the same slice of history — there they already agree.
      // A NEW array is built rather than assigning into `trail`: sampleTrailUntil may hand
      // back a view of the store's own track, and writing into that would corrupt the record.
      const drawnHead = scrubbing ? undefined : aircraftMarkers.current.get(sel?.id ?? '')?.cur
      const trailDrawn =
        drawnHead && trail.length >= 1 && Number.isFinite(drawnHead[0]) && Number.isFinite(drawnHead[1])
          ? [...trail.slice(0, -1), { ...trail[trail.length - 1], lng: drawnHead[0], lat: drawnHead[1] }]
          : trail
      if (trailDrawn.length >= 2) {
        trailFeatures.push({
          type: 'Feature',
          properties: { w: 3, o: 0.8 },
          geometry: { type: 'LineString', coordinates: trailDrawn.map((p) => [p.lng, p.lat]) },
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
    // So opening/closing the tracking view swaps the glyph immediately rather than on the
    // next feed poll — a mode change that visibly lags up to 3s reads as a broken control.
    overwatchAircraftId,
  ])

  // Markers are culled to what the camera can see, so they must be recomputed when
  // the view moves. Without this, panning to a new area shows an empty map until the
  // next feed poll — which can be 30 minutes away.
  const [markerTick, setMarkerTick] = useState(0)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const bump = () => setMarkerTick((t) => t + 1)
    map.on('moveend', bump)
    map.on('zoomend', bump)
    return () => {
      map.off('moveend', bump)
      map.off('zoomend', bump)
    }
  }, [ready])

  // ── Report markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    // ── Viewport culling ─────────────────────────────────────────────────
    // Every report used to become a DOM marker whether or not it was anywhere near
    // the camera. At 130 reports that is 130 animated elements, and in Overwatch —
    // where the camera is nose-down over ONE unit — nearly all of them were far
    // off-screen and still burning frames. Measured with the camera over a single
    // contact: 96 report markers and 25 blinking police in the DOM, sustain 33.7fps.
    // Only what can actually be seen gets a marker now, with a margin so panning
    // does not pop them in at the very edge of the screen.
    const b = map.getBounds()
    const padLng = Math.max(0.01, (b.getEast() - b.getWest()) * 0.15)
    const padLat = Math.max(0.01, (b.getNorth() - b.getSouth()) * 0.15)
    const inView = (lat: number, lng: number) =>
      lat >= b.getSouth() - padLat && lat <= b.getNorth() + padLat &&
      lng >= b.getWest() - padLng && lng <= b.getEast() + padLng

    const visible = layers.reports
      ? reports.filter(
          (r) =>
            r.reportedAgo - scrubT >= 0 &&
            // The selected contact is NEVER culled. It is the thing being looked at,
            // and in Overwatch it is the thing being orbited — a unit that vanished
            // from the map the moment you opened its own view would be absurd.
            (r.id === selectedReportId || inView(r.lat, r.lng))
        )
      : []
    const live = new Set<string>()

    for (const r of visible) {
      // A report with no usable position is SKIPPED, not drawn. This loop used to
      // hand its coordinates straight to setLngLat: a single report arriving without
      // a lat/lng threw "Invalid LngLat object: (NaN, NaN)" INSIDE the map's error
      // boundary, which took the entire map down — aircraft, reports and all — over
      // one bad row. The relay's own filter makes that rare, but "rare" is not
      // "impossible" on a service-to-service boundary, and the failure mode was the
      // whole product. Skipping the row degrades one contact instead.
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue
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
      // Rebuild the marker's innards only when something actually changed.
      //
      // This used to assign innerHTML unconditionally on EVERY pass, and the effect
      // re-runs on every feed poll — so every poll re-parsed an SVG and re-created
      // the callout for every marker on screen. Replacing the children also RESTARTS
      // any CSS animation inside them, which is what made the police blink stutter
      // in time with the feed. The age string only moves once a minute, so keying on
      // it removes almost all of that churn.
      const renderKey = `${r.kind}|${color}|${confirmed ? 'c' : 'n'}|${ageStr}`
      if (el.dataset.vpKey !== renderKey) {
        el.dataset.vpKey = renderKey
        el.innerHTML =
          reportMarkerSVG(r.kind, color, 30) +
          `<div class="vp-rp-callout${confirmed ? ' confirmed' : ''}">` +
          `<span class="vp-co-kind">${r.kind.toUpperCase()}</span>` +
          `<span class="vp-co-age">${ageStr}</span>` +
          `<div class="vp-co-stem"></div></div>`
        // The RED half of the police overglow. A real element, not a pseudo-element: `::before`
        // is the invisible 44px touch target and `::after` is already the blue ring, and one
        // element cannot cross-fade two colours independently.
        //
        // Appended HERE, inside the rebuild, because the assignment above replaces every child —
        // a span added once at marker creation would be destroyed the first time the age string
        // ticked over. It carries no text and is aria-hidden: it is light, not information.
        const glow = document.createElement('span')
        glow.className = 'vp-rp-glow'
        glow.setAttribute('aria-hidden', 'true')
        el.appendChild(glow)
      }
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
  }, [ready, reports, scrubT, layers.reports, selectedReportId, onSelectReport, markerTick])

  // ── Overwatch: circle a ground unit and stand its hollow model on the mark ──
  // Two effects, deliberately. The one that matters is that the CAMERA must not
  // restart when data polls: `reports` is a fresh array on every feed tick, so an
  // orbit effect that depended on it would re-run easeTo and reset the bearing
  // several times a minute — the view would stutter instead of circling. The
  // camera therefore reads reports through a ref and depends only on WHICH report
  // is being orbited.
  const orbitRef = useRef<number | null>(null)
  const ghostMarker = useRef<maplibregl.Marker | null>(null)
  const orbitCentreRef = useRef<{ lat: number; lng: number } | null>(null)
  const reportsRef = useRef(reports)
  useEffect(() => {
    reportsRef.current = reports
  }, [reports])

  useEffect(() => {
    const map = mapRef.current
    const stopOrbit = () => {
      if (orbitRef.current !== null) {
        cancelAnimationFrame(orbitRef.current)
        orbitRef.current = null
      }
    }
    if (!ready || !map || !overwatchReportId) {
      stopOrbit()
      orbitCentreRef.current = null
      return
    }
    const report = reportsRef.current.find((r) => r.id === overwatchReportId)
    // A stealth / head-up view refuses rotation outright (northLock), because the
    // operator is judging north against the ground there. Overwatch still draws
    // its ghost in that mode; it just leaves the camera alone rather than fighting
    // the north lock.
    //
    // The finite check is not paranoia: a camera move to a non-finite coordinate
    // THROWS, and that throw lands in the map's error boundary and takes the whole
    // map down rather than just this view. A report that arrives without a usable
    // position is therefore refused here, before it can reach the camera.
    if (
      !report ||
      northLock ||
      !Number.isFinite(report.lat) ||
      !Number.isFinite(report.lng)
    ) {
      stopOrbit()
      return
    }

    orbitCentreRef.current = { lat: report.lat, lng: report.lng }
    const SETTLE_MS = 950
    map.easeTo({
      center: [report.lng, report.lat],
      zoom: Math.max(map.getZoom(), OVERWATCH_ZOOM),
      pitch: OVERWATCH_PITCH,
      duration: SETTLE_MS,
      essential: true,
    })

    stopOrbit()
    // The sweep starts only AFTER the settle has finished. MapLibre cancels a
    // running camera animation the moment the next camera command arrives, so a
    // setBearing issued during the easeTo stopped it dead — measured: the centre
    // arrived, the pitch stalled at 1.2° and the zoom never moved, leaving the view
    // flat and wide. Starting on a timer just past the settle keeps the two
    // commands from overlapping.
    const startTimer = window.setTimeout(() => {
      let last = performance.now()
      // The sweep is SLOW — a handful of degrees per second — so redrawing satellite
      // imagery plus terrain sixty times a second to express it is almost all waste.
      // Measured in the orbit with only ONE marker on screen and a fully culled DOM:
      // 8.8fps, because every frame carried a full re-render of imagery and terrain.
      // The bearing is therefore applied at ~30Hz while the ANGLE accumulates every
      // frame, so the sweep keeps exactly the same speed and only the redraw rate
      // drops. Skipping the accumulation would have silently slowed the orbit down.
      const ORBIT_APPLY_MS = 33
      let lastApply = last
      let pendingDeg = 0
      const tick = (now: number) => {
        const dt = (now - last) / 1000
        last = now
        pendingDeg += OVERWATCH_ORBIT_DPS * dt
        if (now - lastApply >= ORBIT_APPLY_MS) {
          lastApply = now
          // setBearing, not easeTo — a single easeTo sweeps once and then stops at
          // 360°, and the sweep is meant to be continuous.
          map.setBearing((map.getBearing() + pendingDeg) % 360)
          pendingDeg = 0
        }
        orbitRef.current = requestAnimationFrame(tick)
      }
      orbitRef.current = requestAnimationFrame(tick)
    }, SETTLE_MS + 50)

    return () => {
      window.clearTimeout(startTimer)
      stopOrbit()
      // Flatten the pitch INSTANTLY — not with an easeTo.
      //
      // This was `easeTo({ pitch: 0, duration: 500 })`, and it did not work. Closing
      // Overwatch re-runs the north-up hold above, which fires setBearing(0) because
      // the sweep left the bearing non-zero — and a camera command CANCELS a running
      // camera animation. An independent review measured the result: the map stayed
      // stuck at pitch 58° indefinitely, with the pin's setBearing landing 3 ms after
      // the exit and killing the flatten. setPitch applies immediately, so there is
      // no animation for the pin to cancel and the pitch cannot survive the exit.
      //
      // The bearing returns to north via that same hold. Centre and zoom are
      // deliberately LEFT where they are: the operator has just left a view of this
      // mark, so leaving them looking at it is the useful place to be, and snapping
      // the camera back would also undo a pan they may have made while orbiting.
      map.setPitch(DEFAULT_PITCH)
    }
  }, [ready, overwatchReportId, northLock])

  /**
   * ── 3D terrain, scoped to Overwatch ──────────────────────────────────────────
   *
   * ONE effect owns this, rather than a call tacked onto each camera effect,
   * because the states that matter are not "the ground orbit opened" and "the
   * aircraft view opened" — they are "the map is tilted" and "the map is flat".
   * There are four paths between those two, and the fourth is the one that gets
   * forgotten: swapping the basemap while a view is open.
   *
   * That fourth case is why there is a styledata listener. setStyle() rebuilds the
   * style from scratch, which DROPS any attached terrain and says nothing at all
   * about doing it — the camera keeps its tilt, the ground silently goes flat, and
   * the only symptom is that the feature looks like it never worked. Re-asserting on
   * styledata covers the window while the new style's sources settle.
   *
   * The tilt condition deliberately MIRRORS the camera effects. Terrain beneath a
   * camera that is not tilted is invisible, so attaching it there would spend DEM
   * requests on tiles nobody can see. northLock (stealth / head-up) refuses the tilt
   * for a ground contact, so it refuses the terrain with it.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const tilted = !!(
      overwatchAircraftId ||
      (overwatchReportId && !northLock && !headingMode)
    )
    applyTerrain(map, tilted)
    const reassert = () => applyTerrain(map, tilted)
    map.on('styledata', reassert)
    return () => {
      map.off('styledata', reassert)
      // Detach unconditionally on the way out, whatever the next state is. Leaving
      // terrain attached to a flat map is invisible but still costs tiles, and the
      // next run of this effect re-attaches it if it is still wanted.
      applyTerrain(map, false)
    }
  }, [ready, overwatchReportId, overwatchAircraftId, northLock, headingMode, viewType])

  /**
   * ── Overwatch on an AIRCRAFT: a FIXED view that follows the contact ─────────────────────
   *
   * Deliberately NOT an orbit. A ground report is stationary, so sweeping a circle around it
   * shows it from every side. An aircraft is already travelling, and orbiting something that is
   * itself moving is two motions fighting each other — the operator ends up chasing a subject
   * that never stays framed. So the bearing is pinned north and the camera simply keeps the
   * contact centred, which is what makes the satellite ground beneath it readable.
   *
   * Position comes from the marker's own `cur` — the same interpolated point the prediction loop
   * draws the icon at — so the camera moves as smoothly as the aircraft does instead of stepping
   * once per poll.
   *
   * The camera does not hand control back while this is open: a follow view that also let you
   * pan would drift off the subject and stop meaning anything. Exiting returns it.
   */
  /**
   * The operator's live position, for the tracking view's "hold on me" toggle.
   *
   * A REF, not a dependency, deliberately: putting `user` in the tracking effect's deps would
   * re-run it on every GPS update, and that effect tears down and rebuilds the view — which
   * would reload the 3D model and flash the airframe every ten seconds. Null when there is no
   * fix, and the app's rule holds: the view will not hold on a position the device has not got.
   */
  const operatorPos = useRef<[number, number] | null>(null)
  operatorPos.current = hasUserFix ? [user.lng, user.lat] : null

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !overwatchAircraftId) return

    // Set rather than eased, so an in-flight camera animation cannot fight the follow — the
    // same reasoning as the orbit's exit flatten and the orbit's own start.
    // A helicopter works locally; a plane crosses the state. Framing both at one scale would
    // either crop the plane's surroundings or lose the helicopter in empty country, so fixed
    // wing is framed two zoom levels further out.
    const target = aircraftMarkers.current.get(overwatchAircraftId)
    const targetZoom =
      target?.role === 'rotary' ? OVERWATCH_AIRCRAFT_ZOOM : OVERWATCH_AIRCRAFT_ZOOM - 2
    map.setPitch(OVERWATCH_TRACK_PITCH)
    // SET, not max().
    //
    // This was Math.max(map.getZoom(), targetZoom), which kept the CLOSER of the two framings —
    // so leaving one contact's view and opening another inherited the previous zoom entirely.
    // Measured: the plane opened at the helicopter's 14 instead of its own 12, the two frames
    // were identical, and the wider fixed-wing framing never happened at all. The framing IS the
    // feature here, so it is set outright.
    map.setZoom(targetZoom)

    // ── The real airframe, in 3D ────────────────────────────────────────────────────
    // This view is a genuine side elevation — the camera sits abeam at pitch 78 — and a
    // flat glyph has to FAKE that geometry. `gods-eye-view` takes the honest route for the
    // same situation: draw the actual glTF airframe when the camera is close enough to see
    // it, keep the flat billboard when it is not. This is that, scoped to this one view.
    //
    // The flat side glyph is NOT removed, only hidden: it stays the fallback if the model
    // fails to load, and it is restored the moment the view closes.
    //
    // The module is imported dynamically so three.js is not part of the bundle for the
    // overwhelming majority of sessions that never open Overwatch on an aircraft.
    const markerEl = target?.marker.getElement() as HTMLDivElement | undefined
    const modelRole: Aircraft3DRole = target?.role === 'rotary' ? 'rotary' : 'fixedwing'
    let view: Aircraft3DView | null = null
    let cancelled = false
    if (markerEl) {
      markerEl.classList.add('vp-ac-marker--3d')
      // Terrain must never dim the CONTACT this view exists to show.
      //
      // MapLibre fades any marker to its "_opacityWhenCovered" — 0.2 by default — whenever it
      // decides terrain occludes the point the marker is drawn at (`_updateOpacity`). Aircraft
      // markers are drawn at their GROUND position, never at altitude, so at pitch 78 the
      // moment any ridge sits between the camera and that point the contact goes translucent.
      // The subject of a tracking view turning into a ghost is worse than the occlusion it is
      // reporting, so the covered opacity is raised to 1 for the tracked contact only.
      // setOpacity(visible, covered) is the public hook; the app's own silent/lost fade is
      // applied to the inner glyph and callout nodes, so it is untouched by this.
      target?.marker.setOpacity('1', '1')
      void import('@/lib/aircraft-3d')
        .then(async (m) => {
          const v = await m.createAircraft3D(modelRole)
          if (cancelled) { v.dispose(); return }
          view = v
          markerEl.appendChild(v.canvas)
        })
        .catch((e) => {
          // Never let a 3D model take the map down — the flat side glyph is already up.
          console.warn('[overwatch] 3D airframe unavailable, keeping the 2D side glyph:', e)
          markerEl.classList.remove('vp-ac-marker--3d')
        })
    }

    let raf: number | null = null
    const tick = () => {
      const entry = aircraftMarkers.current.get(overwatchAircraftId)
      const pos = entry?.cur
      if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
        // ── ABEAM TRACK, after gods-eye-view's HeadingPitchRange ─────────────────────────
        // Its chase camera is a Cesium HeadingPitchRange built from the path's FORWARD heading,
        // and its own comment gives the trick: "HeadingPitchRange positions the camera opposite
        // its heading vector. Passing the forward path heading therefore keeps the camera behind
        // the vehicle." Taken literally that sits BEHIND the contact looking at its tail, which
        // still reads as birdseye.
        //
        // This camera is deliberately offset from it: the bearing is the contact's heading plus
        // SIDE_DEG, so the view sits ABEAM and travels PARALLEL to the contact instead of behind
        // it. The ground then sweeps across the frame and the aircraft reads SIDE-ON, which is
        // what was asked for — "a side angle going parallel with the heli or plane". The glyph is
        // swapped to a side elevation to match (see the marker block).
        //
        // THE SIGN IS ORIENTATION, NOT PREFERENCE. The side glyphs in lib/markers.ts are drawn
        // with the nose pointing LEFT. With SIDE_DEG = -90 the contact travels RIGHT across the
        // screen, so a nose-left glyph faces backwards along its own trail — which is exactly the
        // "the heli is sideways" report, and it measured as a 90deg error. +90 sends the contact
        // LEFT instead, so the nose leads and the trail streams out behind it. The two directions
        // agree. (The earlier attempt drew the right conclusion and then picked the wrong sign.)
        //
        // ROLE DECIDES THE OFFSET, and the two are deliberately different cameras:
        //   ROTARY (+90) stays ABEAM. A helicopter works a small area slowly, and reading the
        //   ground it is circling is the reason this view exists, so the side elevation and the
        //   sideways-travelling frame stay.
        //   FIXED WING (0) is a CHASE. A plane crosses the state; from directly behind, you see
        //   the airframe in perspective with the ground running away under it, which is what a
        //   3D model is for. This is gods-eye-view's own convention — its HeadingPitchRange is
        //   built from the forward heading precisely so the camera ends up behind the vehicle.
        //   That was rejected here once, but for a reason that no longer applies: with a FLAT
        //   glyph a chase reads as birdseye. With a real airframe it does not.
        // The nose is NOT re-oriented for the chase — the model is always yawed onto its own
        // heading, so it is the CAMERA that moved, not the aircraft.
        const SIDE_DEG = 0
        // ONLY ISSUE A CAMERA COMMAND WHEN THE BEARING HAS ACTUALLY MOVED.
        //
        // This was an unconditional setBearing every frame, and it is expensive in a way that
        // is easy to miss: setBearing is a camera command, so it invalidates and repaints the
        // whole map. Measured in the 3D tracking view — the app's worst path — 0.7 FPS with
        // six long tasks totalling 8.0 s. The drift guard below already covered setCenter; the
        // bearing needed the same one.
        //
        // Wrapped shortest-delta on purpose: a heading crossing north goes 359 -> 1, and a raw
        // |a - b| test would read that as 358 degrees of movement and swing the camera the long
        // way round every lap.
        const wantBearing = (entry?.hdgShown ?? 0) + SIDE_DEG
        const bearingNow = map.getBearing()
        let dBear = (wantBearing - bearingNow) % 360
        if (dBear > 180) dBear -= 360
        if (dBear < -180) dBear += 360
        if (Math.abs(dBear) > 0.05) map.setBearing(bearingNow + dBear)
        // Only issue a camera command when the contact has actually drifted. A stationary one
        // would otherwise cancel an unrelated animation every single frame.
        // WHICH POINT THE CAMERA HOLDS. The contact, unless the operator has asked for their
        // own position — which is the whole point of the toggle, since this view exists to read
        // a patch of GROUND and sometimes the patch that matters is the one you are standing on.
        const focus = overwatchUserView && operatorPos.current ? operatorPos.current : pos
        const c = map.getCenter()
        if (Math.abs(c.lng - focus[0]) > 1e-6 || Math.abs(c.lat - focus[1]) > 1e-6) {
          map.setCenter([focus[0], focus[1]])
        }
      }
      if (view) {
        const b = map.getBearing()
        // The map rotates every marker by −bearing, so the canvas counter-rotates by
        // +bearing to stay screen-aligned. Without it the airframe arrives rolled 90°,
        // because the marker is map-rotation-aligned for the heading maths.
        view.canvas.style.transform = `translate(-50%, -50%) rotate(${b}deg)`
        view.render({
          bearingDeg: b,
          pitchDeg: map.getPitch(),
          headingDeg: entry?.hdgShown ?? 0,
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      cancelled = true
      view?.dispose()
      view = null
      markerEl?.classList.remove('vp-ac-marker--3d')
      // Hand the marker back to MapLibre's default occlusion fade.
      target?.marker.setOpacity('1', '0.2')
      // Flatten immediately on the way out, for the same reason the orbit does: an eased
      // flatten gets cancelled by the next camera command, an instant one cannot be.
      map.setPitch(DEFAULT_PITCH)
      map.setBearing(0)
    }
  }, [ready, overwatchAircraftId, overwatchUserView])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !overwatchReportId) {
      ghostMarker.current?.remove()
      ghostMarker.current = null
      return
    }
    const report = reports.find((r) => r.id === overwatchReportId)
    // A report with no usable position is refused here for the same reason the
    // camera refuses it above: setLngLat with a non-finite coordinate throws into
    // the map's error boundary and takes the WHOLE map down, not just this view.
    const model =
      report && Number.isFinite(report.lat) && Number.isFinite(report.lng)
        ? ghostModelFor(report.kind)
        : null
    // A kind with no honest model — stop, checkpoint, hidden, helicopter — gets
    // no ghost at all. Better no object than the wrong object on the mark.
    if (!report || !model) {
      ghostMarker.current?.remove()
      ghostMarker.current = null
      return
    }

    // Follow a re-report. Waze revises a position as the report is confirmed, and
    // a ghost left standing on the old one reads as a second unit. The centre is
    // SET rather than eased: an in-flight easeTo would fight the orbit's own
    // per-frame setBearing, and a correction of this size is imperceptible.
    const centre = orbitCentreRef.current
    if (!northLock && centre) {
      const movedM = Math.hypot(
        (report.lat - centre.lat) * 111320,
        (report.lng - centre.lng) * 111320 * Math.cos((centre.lat * Math.PI) / 180)
      )
      if (movedM > 30) {
        orbitCentreRef.current = { lat: report.lat, lng: report.lng }
        map.setCenter([report.lng, report.lat])
      }
    }

    if (!ghostMarker.current) {
      const el = document.createElement('div')
      el.className = 'vp-ghost-marker'
      ghostMarker.current = new maplibregl.Marker({
        element: el,
        // Bottom-anchored: the model STANDS on the reported point, so the mark is
        // where its wheels are rather than its centre.
        anchor: 'bottom',
      })
        .setLngLat([report.lng, report.lat])
        .addTo(map)
    }
    const el = ghostMarker.current.getElement() as HTMLDivElement
    // Threat red for a unit, informational blue for a camera — the same
    // convention the badge layer uses, so the two can never disagree about what
    // colour a camera is.
    const color = model === 'police' ? RED : BLUE
    el.style.setProperty('--ghost-c', color)
    // Rebuild the markup ONLY when the model or colour actually changed.
    //
    // This effect re-runs on every feed poll, and an unconditional innerHTML
    // reassignment re-parses the SVG and RESTARTS the 6.5s hover / 18s orbit CSS
    // animations each time — an independent review measured the ghost visibly
    // stuttering at the poll cadence. Keyed rather than compared by string so the
    // check is O(1) and cannot be fooled by markup drift.
    const ghostKey = `${model}:${color}`
    if (el.dataset.ghostKey !== ghostKey) {
      el.dataset.ghostKey = ghostKey
      el.innerHTML = ghostMarkerSVG(model, color, 96)
    }
    ghostMarker.current.setLngLat([report.lng, report.lat])
  }, [ready, overwatchReportId, reports, northLock])

  // ── Community sighting dots (crowdsourced, Signal Blue, APPROX) ──────────
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
        // Built as DOM nodes with textContent, NEVER innerHTML: aircraftHex comes
        // from a public POST /api/sighting. This label used to be a template string
        // interpolating that value, which made a caller-supplied identifier parse as
        // HTML in the application origin — a stored XSS reachable by anyone who
        // viewed the map while the dot was fresh. Uppercasing on the server does not
        // save it, because HTML character references survive case folding
        // (`&#97;lert` decodes to `alert`). The route now also validates the
        // identifier; this is the second layer.
        const pulse = document.createElement('div')
        pulse.className = 'vp-cdot-pulse'
        const core = document.createElement('div')
        core.className = 'vp-cdot-core'
        const label = document.createElement('div')
        label.className = 'vp-cdot-label'
        label.textContent = `${dot.aircraftHex} · APPROX`
        el.append(pulse, core, label)
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
        // The body's turn runs here so it finishes even if the contact goes quiet mid-glide.
        glideHeading(entry, now)
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
        // Absorb the correction that came with the last fix. At k=1 the marker is still
        // drawing where it was, so the first frame after a fix is continuous; by k=0 the
        // offset has decayed to nothing and the marker sits exactly on the prediction.
        let drawLat = p.lat
        let drawLng = p.lng
        if (entry.settle) {
          const k = 1 - (now - entry.settle.atMs) / FIX_SETTLE_MS
          if (k <= 0) entry.settle = null
          else if (entry.settle.glide) {
            drawLat += (entry.settle.lat - drawLat) * k
            drawLng += (entry.settle.lng - drawLng) * k
          }
        }
        // Skip sub-pixel churn: MapLibre re-projects on every setLngLat, and a parked
        // aircraft would otherwise be pushed through that 60 times a second for nothing.
        if (Math.abs(drawLng - entry.cur[0]) < 1e-6 && Math.abs(drawLat - entry.cur[1]) < 1e-6) continue
        entry.cur = [drawLng, drawLat]
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
// mode (Esri is the whole basemap and must stay shown).
//
// SATELLITE MODE IS DETECTED BY THE VECTOR *BACKGROUND LAYER*, NOT BY "any vector source".
// It used to be the latter, and that silently broke the whole satellite basemap: the
// satellite style gained a vector source of its own (the place-label layer needs something
// to sit on), so `hasVector` became true in satellite mode, this guard stopped returning,
// and line below set the ONLY basemap layer — esri-imagery — to visibility:none. The map
// then painted black with labels floating on it and issued ZERO imagery requests. A
// background layer is present in every vector flavour and absent from the satellite style,
// so it is the honest discriminator.
function applySatFallback(map: maplibregl.Map) {
  try {
    if (!map.getLayer('esri-imagery')) return
    const style = map.getStyle()
    const layers = (style?.layers || []) as any[]
    const hasVectorBackground = layers.some((l) => l.type === 'background')
    if (!hasVectorBackground) return // satellite mode — leave the imagery as the base
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
  // The bearing the sensor is inferred to be on — NOT the airframe's heading.
  el.style.transform = `rotate(${entry.pointing?.bearingDeg ?? entry.hdg ?? 0}deg)`

  const clear = (key: string) => {
    if (entry.coneKey !== key) { el.innerHTML = ''; entry.coneKey = key }
  }
  if (!entry.live || entry.altM === null) return clear('none')

  // The role changes the model, not just the glyph: a hovering helicopter looks down more
  // steeply and scans wider than a fixed wing that must keep flying forward.
  const cone = visionConeForAltitude(entry.altM, {
    role: entry.role,
    // The fleet's aircraft carry a stabilised EO/IR turret, so the useful reach is the
    // pod's, not an unaided eye's. See EOIR_ZOOM_ESTIMATE for how that number is derived.
    sensorZoom: EOIR_ZOOM_ESTIMATE,
    maxRangeM: MAX_SENSOR_RANGE_M,
    // The uncertainty in the inferred bearing IS the cone's width: an orbit estimate is
    // narrow, a bare along-track fallback is wide.
    halfFovDeg: entry.pointing?.spreadDeg,
  })
  if (!cone) return clear(`closed-${entry.role}`)

  const centre = map.getCenter()
  const mpp = metresPerPixel(map.getZoom(), centre.lat)
  const inferred = entry.pointing && entry.pointing.basis !== 'nose'
  const key = `${entry.role}:${Math.round(cone.nearM)}:${Math.round(cone.farM)}:${mpp.toFixed(2)}`
    + `:${Math.round(entry.pointing?.bearingDeg ?? entry.hdg)}:${entry.pointing?.basis ?? 'none'}:${cone.halfAngleDeg}`
  if (key === entry.coneKey) return
  entry.coneKey = key
  // Teal when the bearing is inferred from track geometry; muted grey when it is only the
  // nose. The difference is deliberate: an operator should be able to tell at a glance
  // which cones are a prediction and which are a placeholder.
  el.innerHTML = visionConeSVG(cone, mpp, {
    idSuffix: entry.markerId,
    colour: inferred ? '45, 212, 191' : '148, 163, 184',
  })
}

/**
 * Turn the body toward the fix's heading over the same window as the position glide.
 *
 * A heading arrives per fix and can honestly differ from the previous one by 30–90° after a
 * gap; assigning it directly made the airframe twitch. Silent and scrubbed contacts never
 * reach here — the data pass sets their rotation outright.
 *
 * There is no per-role exception: every airframe's nose follows its heading (see the data pass).
 * An earlier pass skipped rotary here because it pinned them upright — that pin is gone, because
 * it left helicopters flying with their nose locked north.
 */
function glideHeading(entry: AircraftMarkerEntry, now: number): void {
  const target = entry.hdg
  const remaining = ((target - entry.hdgShown + 540) % 360) - 180
  if (Math.abs(remaining) < 0.1) return
  const k = entry.settle ? Math.max(0, Math.min(1, (now - entry.settle.atMs) / FIX_SETTLE_MS)) : 1
  const delta = ((target - entry.hdgFrom + 540) % 360) - 180
  entry.hdgShown = k >= 1 ? target : (entry.hdgFrom + delta * k + 360) % 360
  if (k >= 1) entry.hdgFrom = target
  entry.rot.style.transform = `rotate(${entry.hdgShown}deg)`
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
