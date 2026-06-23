'use client'

/**
 * AROverlay — "Paranoid Schizophrenia" mode
 *
 * Point your camera at the sky and see police aircraft overlaid in real time.
 *
 * NEW: Visual sighting pings
 *   - If you see a helicopter that is NOT showing on the radar, tap
 *     "PING SKY" and the app captures your bearing + elevation and
 *     submits it to the server as a visual sighting ray.
 *   - When 2+ users ping the same dark aircraft, the server triangulates
 *     an approximate position and pushes a community dot to all users' maps.
 *   - Community dots appear as pulsing purple markers with a trajectory arrow.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Aircraft } from '@/lib/store'
import type { CommunityDot } from '@/lib/visual-sighting'

// ── Geometry ──────────────────────────────────────────────────────────────

const R = 6371000

function toRad(d: number) { return (d * Math.PI) / 180 }
function toDeg(r: number) { return (r * 180) / Math.PI }

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const dLng = toRad(toLng - fromLng)
  const lat1 = toRad(fromLat), lat2 = toRad(toLat)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function elevationDeg(distM: number, altFt: number): number {
  const altM = altFt * 0.3048
  if (distM < 1) return 90
  return toDeg(Math.atan2(altM, distM))
}

// ── Types ─────────────────────────────────────────────────────────────────

interface DeviceOrientation { alpha: number; beta: number; gamma: number }

interface ARTarget {
  aircraft: Aircraft
  azimuth: number
  elevation: number
  distM: number
  distKm: string
}

interface ScreenPos { x: number; y: number; visible: boolean }

const H_FOV = 65
const V_FOV = 50

// ── AR math ───────────────────────────────────────────────────────────────

function project(
  azimuth: number,
  elevation: number,
  orientation: DeviceOrientation,
  screenW: number,
  screenH: number,
): ScreenPos {
  let dAz = azimuth - orientation.alpha
  if (dAz > 180) dAz -= 360
  if (dAz < -180) dAz += 360

  const phoneTilt = orientation.beta - 90
  const dEl = elevation - phoneTilt

  const xFrac = 0.5 + dAz / H_FOV
  const yFrac = 0.5 - dEl / V_FOV

  const visible = xFrac > -0.1 && xFrac < 1.1 && yFrac > -0.1 && yFrac < 1.1

  return { x: xFrac * screenW, y: yFrac * screenH, visible }
}

// ── Session ID (anonymous, persisted per device) ──────────────────────────

function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr'
  let id = localStorage.getItem('vp_session_id')
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('vp_session_id', id)
  }
  return id
}

// ── Component ─────────────────────────────────────────────────────────────

interface AROverlayProps {
  aircraft: Aircraft[]
  communityDots?: CommunityDot[]
  userLat: number
  userLng: number
  onClose: () => void
  onSelectAircraft?: (ac: Aircraft) => void
}

type PingState = 'idle' | 'naming' | 'sending' | 'sent' | 'error'

export function AROverlay({
  aircraft,
  communityDots = [],
  userLat,
  userLng,
  onClose,
  onSelectAircraft,
}: AROverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [orientation, setOrientation] = useState<DeviceOrientation>({ alpha: 0, beta: 90, gamma: 0 })
  const orientationRef = useRef<DeviceOrientation>({ alpha: 0, beta: 90, gamma: 0 })
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [orientationGranted, setOrientationGranted] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  // Ping state
  const [pingState, setPingState] = useState<PingState>('idle')
  const [pingLabel, setPingLabel] = useState('')
  const [lastPingResult, setLastPingResult] = useState<{ sightingCount: number; radiusM: number } | null>(null)

  // ── Camera setup ────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      } catch (e: any) {
        setCameraError(e.message || 'Camera access denied')
      }
    }
    startCamera()
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  // ── Device orientation ──────────────────────────────────────────────────
  const requestOrientation = useCallback(async () => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const perm = await (DeviceOrientationEvent as any).requestPermission()
        if (perm !== 'granted') return
      } catch { return }
    }
    setOrientationGranted(true)
  }, [])

  useEffect(() => {
    if (typeof (DeviceOrientationEvent as any).requestPermission !== 'function') {
      setOrientationGranted(true)
    }
  }, [])

  useEffect(() => {
    if (!orientationGranted) return
    function handler(e: DeviceOrientationEvent) {
      const o = { alpha: e.alpha ?? 0, beta: e.beta ?? 90, gamma: e.gamma ?? 0 }
      setOrientation(o)
      orientationRef.current = o
    }
    window.addEventListener('deviceorientation', handler, true)
    return () => window.removeEventListener('deviceorientation', handler, true)
  }, [orientationGranted])

  // ── Resize observer ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width, h: height })
    })
    ro.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // ── Compute AR targets ──────────────────────────────────────────────────
  const targets: ARTarget[] = aircraft
    .filter(ac => ac.isActive && ac.latitude !== 0 && ac.longitude !== 0)
    .map(ac => {
      const distM = haversineM(userLat, userLng, ac.latitude, ac.longitude)
      const azimuth = bearingDeg(userLat, userLng, ac.latitude, ac.longitude)
      const elevation = elevationDeg(distM, ac.altitude)
      return { aircraft: ac, azimuth, elevation, distM, distKm: (distM / 1000).toFixed(1) }
    })
    .filter(t => t.distM < 50000)

  // ── Community dot AR targets ─────────────────────────────────────────────
  interface DotTarget {
    dot: CommunityDot
    azimuth: number
    elevation: number
    distM: number
    distKm: string
  }
  const dotTargets: DotTarget[] = communityDots
    .filter(d => d.isFresh)
    .map(d => {
      const distM = haversineM(userLat, userLng, d.lat, d.lng)
      const azimuth = bearingDeg(userLat, userLng, d.lat, d.lng)
      const elevation = elevationDeg(distM, d.altFt)
      return { dot: d, azimuth, elevation, distM, distKm: (distM / 1000).toFixed(1) }
    })
    .filter(t => t.distM < 50000)

  // ── Ping submission ──────────────────────────────────────────────────────
  const submitPing = useCallback(async (label: string) => {
    if (userLat === 0 && userLng === 0) return
    const o = orientationRef.current
    // Elevation: phone tilt relative to horizon
    const elevation = Math.max(0, o.beta - 90)

    setPingState('sending')
    try {
      const res = await fetch('/api/sighting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aircraftHex: label.toUpperCase().replace(/\s+/g, '') || 'UNKNOWN',
          observerLat: userLat,
          observerLng: userLng,
          bearingDeg: o.alpha,
          elevationDeg: elevation,
          sessionId: getSessionId(),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setPingState('sent')
        setLastPingResult({
          sightingCount: data.sightingCount,
          radiusM: data.dot?.radiusM ?? 5000,
        })
        setTimeout(() => { setPingState('idle'); setLastPingResult(null) }, 4000)
      } else {
        setPingState('error')
        setTimeout(() => setPingState('idle'), 3000)
      }
    } catch {
      setPingState('error')
      setTimeout(() => setPingState('idle'), 3000)
    }
  }, [userLat, userLng])

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200] bg-black overflow-hidden"
      style={{ touchAction: 'none' }}
    >
      {/* Camera feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline muted autoPlay
      />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)' }}
      />

      {/* HUD header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
        <div>
          <div className="font-mono text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--red)' }}>
            PARANOID MODE
          </div>
          <div className="font-mono text-[9px] text-white/50 tracking-wide">
            {targets.length} ADS-B · {dotTargets.length} community · hdg {Math.round(orientation.alpha)}°
          </div>
        </div>
        <button
          className="pointer-events-auto w-9 h-9 rounded-full flex items-center justify-center text-white"
          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}
          onClick={onClose}
        >✕</button>
      </div>

      {/* Horizon crosshair */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-12 h-[1px] bg-white/20" />
        <div className="w-[1px] h-12 bg-white/20 absolute" />
        <div className="w-4 h-4 rounded-full border border-white/20 absolute" />
      </div>

      {/* iOS orientation permission */}
      {!orientationGranted && typeof (DeviceOrientationEvent as any).requestPermission === 'function' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            className="px-5 py-3 rounded-xl font-semibold text-sm text-white"
            style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}
            onClick={requestOrientation}
          >Enable Orientation Sensor</button>
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
          <div className="text-red-400 font-bold text-sm">Camera unavailable</div>
          <div className="text-white/60 text-xs text-center">{cameraError}</div>
          <div className="text-white/40 text-[10px] text-center">AR mode requires camera access and HTTPS.</div>
        </div>
      )}

      {/* ADS-B aircraft labels */}
      {dims.w > 0 && targets.map(target => {
        const pos = project(target.azimuth, target.elevation, orientation, dims.w, dims.h)
        if (!pos.visible) return null
        const isMlat = target.aircraft.isMlat
        const isLost = !target.aircraft.isActive
        const color = isLost ? 'var(--red)' : isMlat ? 'var(--amber)' : '#22d3ee'

        return (
          <button
            key={target.aircraft.hex}
            className="absolute pointer-events-auto"
            style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}
            onClick={() => onSelectAircraft?.(target.aircraft)}
          >
            <div className="absolute rounded-full border-2" style={{
              width: 48, height: 48, left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              borderColor: color,
              boxShadow: `0 0 12px ${color}55`,
            }} />
            {[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx, sy], i) => (
              <div key={i} className="absolute w-2 h-2" style={{
                left: `calc(50% + ${sx! * 20}px)`, top: `calc(50% + ${sy! * 20}px)`,
                transform: 'translate(-50%, -50%)',
                borderTop: sy! < 0 ? `2px solid ${color}` : 'none',
                borderBottom: sy! > 0 ? `2px solid ${color}` : 'none',
                borderLeft: sx! < 0 ? `2px solid ${color}` : 'none',
                borderRight: sx! > 0 ? `2px solid ${color}` : 'none',
              }} />
            ))}
            <div className="absolute left-1/2 flex flex-col items-center" style={{ top: 'calc(50% + 30px)', transform: 'translateX(-50%)', minWidth: 80 }}>
              <div className="px-2 py-1 rounded font-mono text-[11px] font-bold tracking-wide text-center whitespace-nowrap"
                style={{ background: 'rgba(0,0,0,0.75)', border: `1px solid ${color}55`, color, backdropFilter: 'blur(4px)' }}>
                {target.aircraft.callsign || target.aircraft.registration}
              </div>
              <div className="px-1.5 py-0.5 rounded text-[9px] text-white/70 text-center whitespace-nowrap"
                style={{ background: 'rgba(0,0,0,0.6)' }}>
                {isMlat ? '~' : ''}{target.distKm}km · {target.aircraft.altitude != null ? `${target.aircraft.altitude.toLocaleString()}ft` : '—'}
              </div>
              {isMlat && <div className="text-[8px] mt-0.5" style={{ color: 'var(--amber)' }}>MLAT ±300m</div>}
            </div>
          </button>
        )
      })}

      {/* Community dot labels (dark/untracked aircraft pinged by users) */}
      {dims.w > 0 && dotTargets.map(dt => {
        const pos = project(dt.azimuth, dt.elevation, orientation, dims.w, dims.h)
        if (!pos.visible) return null
        const age = Date.now() - dt.dot.lastSeenAt
        const opacity = Math.max(0.3, 1 - age / (3 * 60 * 1000))

        return (
          <div
            key={dt.dot.aircraftHex}
            className="absolute pointer-events-none"
            style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)', opacity }}
          >
            {/* Purple pulsing ring */}
            <div className="absolute rounded-full border-2 animate-ping" style={{
              width: 56, height: 56, left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              borderColor: '#a855f7',
            }} />
            <div className="absolute rounded-full border-2" style={{
              width: 56, height: 56, left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              borderColor: '#a855f7',
              boxShadow: '0 0 16px #a855f755',
            }} />
            {/* Dashed uncertainty circle */}
            <div className="absolute rounded-full" style={{
              width: 72, height: 72, left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              border: '1px dashed #a855f755',
            }} />
            <div className="absolute left-1/2 flex flex-col items-center" style={{ top: 'calc(50% + 34px)', transform: 'translateX(-50%)', minWidth: 90 }}>
              <div className="px-2 py-1 rounded font-mono text-[11px] font-bold tracking-wide text-center whitespace-nowrap"
                style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid #a855f755', color: '#a855f7', backdropFilter: 'blur(4px)' }}>
                👁 {dt.dot.aircraftHex}
              </div>
              <div className="px-1.5 py-0.5 rounded text-[9px] text-white/70 text-center whitespace-nowrap"
                style={{ background: 'rgba(0,0,0,0.6)' }}>
                ~{dt.distKm}km · {dt.dot.sightingCount} ping{dt.dot.sightingCount !== 1 ? 's' : ''}
              </div>
              <div className="text-[8px] mt-0.5" style={{ color: '#a855f7' }}>
                ±{Math.round(dt.dot.radiusM)}m · COMMUNITY
              </div>
            </div>
          </div>
        )
      })}

      {/* PING SKY button — bottom centre */}
      <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center gap-2 px-4">
        {/* Ping result feedback */}
        {pingState === 'sent' && lastPingResult && (
          <div className="px-4 py-2 rounded-xl text-center animate-pulse"
            style={{ background: 'rgba(168,85,247,0.25)', border: '1px solid #a855f7', backdropFilter: 'blur(8px)' }}>
            <div className="font-mono text-[11px] font-bold" style={{ color: '#a855f7' }}>
              PING SENT ✓
            </div>
            <div className="text-[9px] text-white/60">
              {lastPingResult.sightingCount} sighting{lastPingResult.sightingCount !== 1 ? 's' : ''} · ±{Math.round(lastPingResult.radiusM)}m accuracy
            </div>
            {lastPingResult.sightingCount >= 2 && (
              <div className="text-[9px] mt-0.5" style={{ color: '#a855f7' }}>
                Community dot live on all maps
              </div>
            )}
          </div>
        )}
        {pingState === 'error' && (
          <div className="px-4 py-2 rounded-xl text-center"
            style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444' }}>
            <div className="font-mono text-[11px] font-bold text-red-400">PING FAILED</div>
          </div>
        )}

        {/* Naming prompt */}
        {pingState === 'naming' && (
          <div className="w-full max-w-xs rounded-xl p-3 flex flex-col gap-2"
            style={{ background: 'rgba(0,0,0,0.85)', border: '1px solid #a855f7', backdropFilter: 'blur(12px)' }}>
            <div className="font-mono text-[10px] font-bold tracking-wide text-center" style={{ color: '#a855f7' }}>
              AIRCRAFT ID (optional)
            </div>
            <input
              className="w-full bg-transparent border border-white/20 rounded px-2 py-1.5 text-white text-sm font-mono text-center outline-none focus:border-purple-400"
              placeholder="e.g. POL32 or UNKNOWN"
              value={pingLabel}
              onChange={e => setPingLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitPing(pingLabel || 'UNKNOWN') }}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 rounded font-mono text-[10px] font-bold"
                style={{ background: '#a855f7', color: '#fff' }}
                onClick={() => submitPing(pingLabel || 'UNKNOWN')}
              >SEND PING</button>
              <button
                className="px-3 py-1.5 rounded font-mono text-[10px] text-white/50"
                style={{ background: 'rgba(255,255,255,0.08)' }}
                onClick={() => { setPingState('idle'); setPingLabel('') }}
              >CANCEL</button>
            </div>
          </div>
        )}

        {/* Main PING button */}
        {(pingState === 'idle') && (
          <button
            className="flex items-center gap-2 px-6 py-3 rounded-full font-mono text-[12px] font-bold tracking-[0.12em] uppercase transition-all active:scale-95"
            style={{
              background: 'rgba(168,85,247,0.25)',
              border: '2px solid #a855f7',
              color: '#a855f7',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 0 20px #a855f733',
            }}
            onClick={() => { setPingState('naming'); setPingLabel('') }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
            </svg>
            PING SKY
          </button>
        )}
        {pingState === 'sending' && (
          <div className="flex items-center gap-2 px-6 py-3 rounded-full font-mono text-[12px] font-bold"
            style={{ background: 'rgba(168,85,247,0.15)', border: '2px solid #a855f755', color: '#a855f7' }}>
            <div className="w-3 h-3 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
            SENDING...
          </div>
        )}
      </div>

      {/* Bottom HUD */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-2 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
        <div className="font-mono text-[9px] text-white/40 text-center tracking-wide">
          TAP UNIT FOR DETAILS · PING SKY FOR DARK AIRCRAFT · {Math.round(orientation.beta)}° TILT
        </div>
      </div>
    </div>
  )
}
