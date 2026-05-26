'use client'

import { useEffect, useRef, useMemo } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Circle,
  CircleMarker,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import {
  Aircraft,
  Report,
  User,
  TrackPoint,
  sampleTrack,
  sampleTrailUntil,
  computeDistance,
} from '@/lib/data'

interface VPMapProps {
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
}

function MapController({
  focusTarget,
}: {
  focusTarget?: { lat: number; lng: number } | null
}) {
  const map = useMap()

  useEffect(() => {
    if (focusTarget) {
      map.flyTo([focusTarget.lat, focusTarget.lng], 14, {
        duration: 0.7,
      })
    }
  }, [focusTarget, map])

  return null
}

function createAircraftIcon(
  role: 'rotary' | 'fixedwing',
  heading: number,
  isSelected: boolean
): L.DivIcon {
  const size = isSelected ? 44 : 36
  const iconSvg =
    role === 'rotary'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FFB020" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${heading}deg);">
          <path d="M5 8 H19 M12 8 V14 M9 14 H15 M7 17 H17 M11 14 V17 M13 14 V17 M12 5 V8"/>
        </svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#FFB020" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${heading + 90}deg);">
          <path d="M17.8 19.2 L16 11 L8.59 12.42 M21 8 L7 22 L6 11 L4 9 V5 L21 8 Z"/>
        </svg>`

  return L.divIcon({
    html: `<div class="aircraft-marker ${isSelected ? 'selected' : ''}">${iconSvg}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function createReportIcon(
  kind: Report['kind'],
  isSelected: boolean,
  isConfirmed: boolean
): L.DivIcon {
  const size = isSelected ? 32 : 26
  const color = isConfirmed ? '#5BD68A' : '#FF4757'
  const kindIcons: Record<Report['kind'], string> = {
    marked: 'M19 17H5V13L7 7H17L19 13ZM7.5 17V19M16.5 17V19M5 13H19',
    unmarked: 'M19 17H5V13L7 7H17L19 13ZM7.5 17V19M16.5 17V19M5 13H19',
    hidden: 'M2 12S5 5 12 5s10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 11-6 0 3 3 0 016 0',
    stop: 'M12 9V13M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.73 3h16.9a2 2 0 001.73-3l-8.47-14.14a2 2 0 00-3.42 0Z',
    checkpoint: 'M12 9V13M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.73 3h16.9a2 2 0 001.73-3l-8.47-14.14a2 2 0 00-3.42 0Z',
    rbt: 'M12 9V13M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.73 3h16.9a2 2 0 001.73-3l-8.47-14.14a2 2 0 00-3.42 0Z',
    camera: 'M2 12S5 5 12 5s10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 11-6 0 3 3 0 016 0',
  }

  const iconPath = kindIcons[kind] || kindIcons.marked

  return L.divIcon({
    html: `<div class="report-marker ${isSelected ? 'selected' : ''} ${isConfirmed ? 'confirmed' : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="${iconPath}"/>
      </svg>
    </div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function createUserIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div class="user-marker">
      <div class="user-marker-dot"></div>
      <div class="user-marker-pulse"></div>
    </div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
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
}: VPMapProps) {
  const mapRef = useRef<L.Map | null>(null)

  const aircraftPositions = useMemo(() => {
    return aircraft.map((a) => {
      const pos = sampleTrack(a.track, scrubT)
      return { ...a, currentPos: pos }
    })
  }, [aircraft, scrubT])

  const aircraftTrails = useMemo(() => {
    if (!layers.trails) return []
    return aircraft.map((a) => {
      const isSelected = a.id === selectedAircraftId
      const trailMinutes = isSelected ? 15 : 4
      const trail = sampleTrailUntil(a.track, scrubT, trailMinutes * 60)
      return { id: a.id, trail, isSelected }
    })
  }, [aircraft, scrubT, layers.trails, selectedAircraftId])

  const visibleReports = useMemo(() => {
    return reports.filter((r) => {
      const reportAgeAtScrub = r.reportedAgo - scrubT
      return reportAgeAtScrub >= 0
    })
  }, [reports, scrubT])

  // Connection lines: aircraft to nearby reports within 5km
  const connectionLines = useMemo(() => {
    const lines: { from: [number, number]; to: [number, number]; strength: number }[] = []
    aircraftPositions.forEach((a) => {
      if (!a.currentPos) return
      visibleReports.forEach((r) => {
        const dist = computeDistance(a.currentPos!.lat, a.currentPos!.lng, r.lat, r.lng)
        if (dist < 5000) {
          lines.push({
            from: [a.currentPos!.lat, a.currentPos!.lng],
            to: [r.lat, r.lng],
            strength: Math.max(0.1, 1 - dist / 5000),
          })
        }
      })
    })
    return lines
  }, [aircraftPositions, visibleReports])

  // Hex grid: density bins for reports
  const hexCenters = useMemo(() => {
    if (visibleReports.length < 3) return []
    const HEX_SIZE = 0.012
    const bins = new Map<string, { lat: number; lng: number; count: number }>()
    visibleReports.forEach((r) => {
      const col = Math.round(r.lng / (HEX_SIZE * 1.5))
      const row = Math.round(r.lat / (HEX_SIZE * Math.sqrt(3)))
      const key = `${col},${row}`
      const existing = bins.get(key)
      if (existing) {
        existing.count++
      } else {
        bins.set(key, {
          lat: row * HEX_SIZE * Math.sqrt(3),
          lng: col * HEX_SIZE * 1.5,
          count: 1,
        })
      }
    })
    return [...bins.values()].filter((b) => b.count >= 2)
  }, [visibleReports])

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={[user.lat, user.lng]}
        zoom={13}
        className="w-full h-full"
        zoomControl={false}
        attributionControl={false}
        ref={mapRef}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          maxZoom={19}
        />

        <MapController focusTarget={focusTarget} />

        {/* Hex density overlay */}
        {hexCenters.map((hex, i) => (
          <Circle
            key={`hex-${i}`}
            center={[hex.lat, hex.lng]}
            radius={600}
            pathOptions={{
              color: '#FF4757',
              fillColor: '#FF4757',
              fillOpacity: Math.min(0.25, hex.count * 0.08),
              weight: 1,
              opacity: 0.3,
              dashArray: '4, 4',
            }}
          />
        ))}

        {/* Connection lines: aircraft to nearby reports */}
        {connectionLines.map((line, i) => (
          <Polyline
            key={`conn-${i}`}
            positions={[line.from, line.to]}
            pathOptions={{
              color: '#4D7CFF',
              weight: 1,
              opacity: line.strength * 0.4,
              dashArray: '3, 6',
            }}
          />
        ))}

        {/* User position */}
        <Marker position={[user.lat, user.lng]} icon={createUserIcon()}>
          <Circle
            center={[user.lat, user.lng]}
            radius={user.accuracy}
            pathOptions={{
              color: '#4D7CFF',
              fillColor: '#4D7CFF',
              fillOpacity: 0.15,
              weight: 1,
            }}
          />
        </Marker>

        {/* Aircraft trails */}
        {layers.trails &&
          aircraftTrails.map(({ id, trail, isSelected }) => {
            if (trail.length < 2) return null
            const positions: [number, number][] = trail.map((p) => [p.lat, p.lng])
            return (
              <Polyline
                key={`trail-${id}`}
                positions={positions}
                pathOptions={{
                  color: '#FFB020',
                  weight: isSelected ? 3 : 2,
                  opacity: isSelected ? 0.8 : 0.5,
                }}
              />
            )
          })}

        {/* Predictive vector */}
        {layers.predictive &&
          selectedAircraftId &&
          (() => {
            const a = aircraftPositions.find((x) => x.id === selectedAircraftId)
            if (!a?.currentPos) return null
            const pos = a.currentPos
            const hdgRad = ((pos.hdg - 90) * Math.PI) / 180
            const fwd60m = pos.spd * 0.514 * 60
            const dLat = (Math.cos(hdgRad) * fwd60m) / 111000
            const dLng = (Math.sin(hdgRad) * fwd60m) / (111000 * Math.cos((pos.lat * Math.PI) / 180))

            return (
              <Polyline
                positions={[
                  [pos.lat, pos.lng],
                  [pos.lat + dLat, pos.lng + dLng],
                ]}
                pathOptions={{
                  color: '#FFB020',
                  weight: 2,
                  opacity: 0.6,
                  dashArray: '8, 6',
                }}
              />
            )
          })()}

        {/* Aircraft markers */}
        {layers.aircraft &&
          aircraftPositions.map((a) => {
            if (!a.currentPos) return null
            const isSelected = a.id === selectedAircraftId
            return (
              <Marker
                key={a.id}
                position={[a.currentPos.lat, a.currentPos.lng]}
                icon={createAircraftIcon(a.role, a.currentPos.hdg, isSelected)}
                eventHandlers={{ click: () => onSelectAircraft(a.id) }}
              >
                {isSelected && (
                  <Circle
                    center={[a.currentPos.lat, a.currentPos.lng]}
                    radius={150}
                    pathOptions={{ color: '#FFB020', fillColor: 'transparent', weight: 2 }}
                  />
                )}
              </Marker>
            )
          })}

        {/* Report markers */}
        {layers.reports &&
          visibleReports.map((r) => {
            const isSelected = r.id === selectedReportId
            const isConfirmed = r.nThumbsUp >= 5 && r.lastConfirmedAgo < 120
            return (
              <Marker
                key={r.id}
                position={[r.lat, r.lng]}
                icon={createReportIcon(r.kind, isSelected, isConfirmed)}
                eventHandlers={{ click: () => onSelectReport(r.id) }}
              >
                {isSelected && (
                  <Circle
                    center={[r.lat, r.lng]}
                    radius={100}
                    pathOptions={{ color: '#4D7CFF', fillColor: 'transparent', weight: 2 }}
                  />
                )}
              </Marker>
            )
          })}
      </MapContainer>

      <style jsx global>{`
        .aircraft-marker {
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--ink-0);
          border: 2px solid var(--amber);
          border-radius: 50%;
          box-shadow: 0 0 12px var(--amber-glow);
        }
        .aircraft-marker.selected {
          background: var(--amber-wash);
          box-shadow: 0 0 20px var(--amber-glow);
        }
        .report-marker {
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--ink-0);
          border: 2px solid var(--red);
          border-radius: 50%;
          width: 100%;
          height: 100%;
        }
        .report-marker.confirmed { border-color: var(--green); }
        .report-marker.selected {
          box-shadow: 0 0 12px var(--blue-glow);
          border-color: var(--blue);
        }
        .user-marker { position: relative; width: 24px; height: 24px; }
        .user-marker-dot {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 12px; height: 12px;
          background: var(--blue); border: 2px solid white;
          border-radius: 50%; box-shadow: 0 0 8px var(--blue-glow); z-index: 2;
        }
        .user-marker-pulse {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 24px; height: 24px;
          background: var(--blue); border-radius: 50%;
          opacity: 0.3; animation: user-pulse 2s ease-out infinite;
        }
        @keyframes user-pulse {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
