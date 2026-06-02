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
import { buildMapStyle, registerPmtilesProtocol } from '@/lib/map-style'
import { aircraftMarkerSVG, reportMarkerSVG, RED, GREEN } from '@/lib/markers'

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
  }
  focusTarget?: { lat: number; lng: number } | null
  hasSilentAircraft?: boolean
  /** When true, the map shows a crosshair and a click sets the position. */
  pickMode?: boolean
  /** Called with the clicked coordinate while pickMode is active. */
  onMapClick?: (lat: number, lng: number) => void
  /** Live-follow: re-center smoothly (pan only, keep zoom) on focus changes. */
  followMode?: boolean
  /** Fired when the user drags the map, so follow mode can be paused. */
  onUserPan?: () => void
}

// Motion: 400ms camera-focus duration with the design system's spring ease
// (cubic-bezier(0.32,0.72,0,1) ≈ stiffness 260 / damping 28). Aircraft
// positions interpolate over ~900ms so live polls never snap.
const FOCUS_MS = 400
const FOCUS_ZOOM = 14
const AIRCRAFT_TWEEN_MS = 900

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
  cur: [number, number]
  raf: number | null
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
  followMode,
  onUserPan,
}: VPMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const onMapClickRef = useRef(onMapClick)
  useEffect(() => { onMapClickRef.current = onMapClick }, [onMapClick])
  const onUserPanRef = useRef(onUserPan)
  useEffect(() => { onUserPanRef.current = onUserPan }, [onUserPan])
  const followModeRef = useRef(followMode)
  useEffect(() => { followModeRef.current = followMode }, [followMode])

  const userMarker = useRef<maplibregl.Marker | null>(null)
  const aircraftMarkers = useRef<Map<string, AircraftMarkerEntry>>(new Map())
  const reportMarkers = useRef<Map<string, maplibregl.Marker>>(new Map())
  const lastScrubT = useRef(scrubT)

  // ── Initialise map once ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(),
      center: [user.lng, user.lat],
      zoom: 13,
      pitch: 0, // pitch/bearing enabled but default flat, north up
      bearing: 0,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
    })
    mapRef.current = map

    // Tap-to-set position (only acts when pickMode is on, via the live callback).
    map.on('click', (e) => {
      onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng)
    })

    // User dragging the map pauses live-follow.
    map.on('dragstart', () => onUserPanRef.current?.())

    map.on('load', () => {
      // ── Data-overlay sources (updated imperatively below) ──────────────
      const addSrc = (id: string) =>
        map.addSource(id, { type: 'geojson', data: EMPTY })
      addSrc('vp-hex')
      addSrc('vp-conn')
      addSrc('vp-trails')
      addSrc('vp-acc')
      addSrc('vp-predict')

      // Threat density (red, sparse, dashed) — sits lowest.
      map.addLayer({
        id: 'vp-hex-fill',
        type: 'fill',
        source: 'vp-hex',
        paint: { 'fill-color': RED, 'fill-opacity': ['get', 'o'] },
      })
      map.addLayer({
        id: 'vp-hex-line',
        type: 'line',
        source: 'vp-hex',
        paint: { 'line-color': RED, 'line-opacity': 0.3, 'line-width': 1, 'line-dasharray': [4, 4] },
      })

      // Aircraft → nearby report connection lines (signal blue, dashed).
      map.addLayer({
        id: 'vp-conn-line',
        type: 'line',
        source: 'vp-conn',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#4D7CFF', 'line-width': 1, 'line-opacity': ['get', 'o'], 'line-dasharray': [3, 6] },
      })

      // Aircraft trails (aviation amber).
      map.addLayer({
        id: 'vp-trails-line',
        type: 'line',
        source: 'vp-trails',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFB020', 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'] },
      })

      // GPS accuracy disc (signal blue).
      map.addLayer({
        id: 'vp-acc-fill',
        type: 'fill',
        source: 'vp-acc',
        paint: { 'fill-color': '#4D7CFF', 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'vp-acc-line',
        type: 'line',
        source: 'vp-acc',
        paint: { 'line-color': '#4D7CFF', 'line-width': 1, 'line-opacity': 0.4 },
      })

      // Predictive vector for the selected aircraft (amber, dashed).
      map.addLayer({
        id: 'vp-predict-line',
        type: 'line',
        source: 'vp-predict',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#FFB020', 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [8, 6] },
      })

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
      ro.disconnect()
      aircraftMarkers.current.forEach((e) => {
        if (e.raf) cancelAnimationFrame(e.raf)
        e.marker.remove()
      })
      aircraftMarkers.current.clear()
      reportMarkers.current.forEach((m) => m.remove())
      reportMarkers.current.clear()
      userMarker.current?.remove()
      userMarker.current = null
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Camera focus (flyTo with momentum + spring ease) ───────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focusTarget) return
    if (followModeRef.current) {
      // Live follow: pan only, keep the user's current zoom, gentle ease.
      map.easeTo({
        center: [focusTarget.lng, focusTarget.lat],
        duration: 800,
        easing: springEase,
        essential: true,
      })
    } else {
      // Deliberate focus (recenter / select a unit): fly in with momentum.
      map.flyTo({
        center: [focusTarget.lng, focusTarget.lat],
        zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
        duration: FOCUS_MS,
        easing: springEase,
        essential: true,
      })
    }
  }, [ready, focusTarget])

  // ── Pick-location cursor ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''
  }, [ready, pickMode])

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
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat(target)
            .addTo(map)
          entry = { marker, rot, cur: target, raf: null }
          aircraftMarkers.current.set(a.id, entry)
        }

        entry.rot.style.transform = `rotate(${pos.hdg}deg)`
        ;(entry.marker.getElement() as HTMLDivElement).classList.toggle('selected', isSel)
        moveMarker(entry, target, !scrubbing)
      }
    }
    for (const [id, entry] of aircraftMarkers.current) {
      if (!live.has(id)) {
        if (entry.raf) cancelAnimationFrame(entry.raf)
        entry.marker.remove()
        aircraftMarkers.current.delete(id)
      }
    }

    // Trails.
    const trailFeatures: GeoJSON.Feature[] = []
    if (layers.trails) {
      for (const a of aircraft) {
        const isSel = a.id === selectedAircraftId
        const trail = sampleTrailUntil(a.track, scrubT, (isSel ? 15 : 4) * 60)
        if (trail.length < 2) continue
        trailFeatures.push({
          type: 'Feature',
          properties: { w: isSel ? 3 : 2, o: isSel ? 0.8 : 0.5 },
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
      const color = confirmed ? RED : GREEN

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
      el.innerHTML = reportMarkerSVG(r.kind, color, 26)
      el.classList.toggle('selected', isSel)
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

  // Aircraft marker click handlers are bound here so they always see the
  // latest callback identity without recreating markers.
  useEffect(() => {
    if (!ready) return
    for (const [id, entry] of aircraftMarkers.current) {
      ;(entry.marker.getElement() as HTMLDivElement).onclick = () => onSelectAircraft(id)
    }
  }, [ready, aircraft, onSelectAircraft])

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

// Update a GeoJSON source's features.
function setData(map: maplibregl.Map, id: string, features: GeoJSON.Feature[]) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  src?.setData({ type: 'FeatureCollection', features })
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
