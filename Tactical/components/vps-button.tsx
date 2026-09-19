'use client'

/**
 * VPSButton — "Victoria Police Spotted" community ground-unit report control.
 * Standalone left-side map button that expands into the sighting flow.
 *
 * Sighting flow
 * ─────────────
 * Tapping VPS first asks HOW the unit was seen, because the two answers place
 * the contact in completely different places:
 *
 *   IN SIGHT      The unit is visible from where the operator is standing, so
 *                 the contact belongs at the observer's own GPS position —
 *                 the standard report.
 *
 *   OUT OF SIGHT  The unit was seen from a distance and is no longer visible
 *                 from where they are now. Dropping the pin on the observer
 *                 would be flat wrong, so the map zooms onto the observer with
 *                 SIGHTING_PICK_RANGE_M of radius on screen and the operator
 *                 taps the exact spot they saw it.
 *
 * Only after that does the operator choose the unit kind (marked / unmarked /
 * hidden cam), which is the same for both paths.
 */

import { useEffect, useState } from 'react'

export type VPSKind = 'marked' | 'unmarked' | 'hidden'
export type VPSMode = 'in-sight' | 'out-of-sight'

/**
 * Radius, in metres, of map shown when tapping an out-of-sight contact. Small
 * enough that a mis-tap costs a street number rather than a suburb.
 */
export const SIGHTING_PICK_RANGE_M = 70

interface VPSButtonProps {
  /** Submit the report. `coords` is present only for out-of-sight sightings. */
  onReport: (kind: VPSKind, coords?: { lat: number; lng: number }) => void
  /** OUT OF SIGHT chosen — the page arms tap-to-place and zooms the map. */
  onPickSighting: () => void
  /** Coordinate tapped on the map, handed back by the page. */
  pickedPoint?: { lat: number; lng: number } | null
  /** Page-side teardown: pick cancelled, or the report went through. */
  onCancelPick: () => void
}

const KINDS: { kind: VPSKind; label: string; color: string }[] = [
  { kind: 'marked', label: 'Marked Unit', color: 'var(--vp-red)' },
  { kind: 'unmarked', label: 'Unmarked Unit', color: 'var(--vp-red)' },
  { kind: 'hidden', label: 'Hidden Cam / Unit', color: 'var(--vp-purple)' },
]

const MODES: { mode: VPSMode; label: string; sub: string; color: string }[] = [
  { mode: 'in-sight', label: 'IN SIGHT', sub: 'HERE, AT MY POSITION', color: 'var(--vp-cyan)' },
  { mode: 'out-of-sight', label: 'OUT OF SIGHT', sub: 'TAP WHERE I SAW IT', color: 'var(--vp-amber)' },
]

const base: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  letterSpacing: '0.1em',
  cursor: 'pointer',
  userSelect: 'none',
  backdropFilter: 'blur(8px)',
  transition: 'all 160ms ease',
}

/** One tappable option row in the flyout. */
function rowStyle(color: string): React.CSSProperties {
  return {
    ...base,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(8,14,24,0.92)',
    border: `1px solid ${color}`,
    color,
    boxShadow: `0 0 12px ${color}33`,
    whiteSpace: 'nowrap',
    animation: 'vp-fade-in 200ms ease',
  }
}

const dot = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  boxShadow: `0 0 6px ${color}`,
  flexShrink: 0,
})

const sub: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  letterSpacing: '0.12em',
  opacity: 0.66,
}

export function VPSButton({ onReport, onPickSighting, pickedPoint, onCancelPick }: VPSButtonProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<VPSMode | null>(null)
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [confirm, setConfirm] = useState(false)

  // The page sends the tapped coordinate back while the pick is armed.
  useEffect(() => {
    if (pickedPoint && mode === 'out-of-sight') setPoint(pickedPoint)
  }, [pickedPoint, mode])

  const reset = () => {
    setOpen(false)
    setMode(null)
    setPoint(null)
  }

  // Full teardown — also disarms tap-to-place in the page.
  const close = () => {
    reset()
    onCancelPick()
  }

  const chooseMode = (m: VPSMode) => {
    setMode(m)
    setPoint(null)
    // OUT OF SIGHT needs the map: zoom onto the observer, arm the crosshair.
    if (m === 'out-of-sight') onPickSighting()
  }

  const pick = (kind: VPSKind) => {
    onReport(kind, mode === 'out-of-sight' ? point ?? undefined : undefined)
    reset()
    onCancelPick()
    setConfirm(true)
    window.setTimeout(() => setConfirm(false), 2400)
  }

  const awaitingTap = mode === 'out-of-sight' && point === null
  const showKinds = mode === 'in-sight' || (mode === 'out-of-sight' && point !== null)

  return (
    <div className="vp-vps-button" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      {/* Flyout appears above the main button */}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: 'rgba(255,255,255,0.45)',
              paddingLeft: 2,
            }}
          >
            {mode === null ? 'SIGHTING' : mode === 'in-sight' ? 'SIGHTING · IN SIGHT' : 'SIGHTING · OUT OF SIGHT'}
          </span>

          {/* Step 1 — how was it seen? */}
          {mode === null &&
            MODES.map((m) => (
              <button
                key={m.mode}
                onClick={() => chooseMode(m.mode)}
                aria-label={`${m.label} — ${m.sub}`}
                style={{ ...rowStyle(m.color), flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={dot(m.color)} />
                  {m.label}
                </span>
                <span style={{ ...sub, paddingLeft: 16 }}>{m.sub}</span>
              </button>
            ))}

          {/* Step 2a — waiting on the map tap */}
          {awaitingTap && (
            <>
              <div
                style={{
                  ...rowStyle('var(--vp-amber)'),
                  cursor: 'default',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={dot('var(--vp-amber)')} />
                  TAP THE MAP
                </span>
                <span style={{ ...sub, paddingLeft: 16 }}>
                  WHERE YOU SAW IT · {SIGHTING_PICK_RANGE_M} M RADIUS
                </span>
              </div>
              <button onClick={close} style={{ ...rowStyle('rgba(255,255,255,0.35)'), fontSize: 10 }}>
                CANCEL
              </button>
            </>
          )}

          {/* Step 2b — what kind of unit? */}
          {showKinds &&
            KINDS.map((o) => (
              <button
                key={o.kind}
                onClick={() => pick(o.kind)}
                aria-label={`Report ${o.label}`}
                style={rowStyle(o.color)}
              >
                <span style={dot(o.color)} />
                {o.label}
              </button>
            ))}

          {showKinds && mode === 'out-of-sight' && (
            <span style={{ ...sub, color: 'rgba(255,170,0,0.75)', paddingLeft: 2 }}>TAP MAP TO ADJUST</span>
          )}

          {(showKinds || awaitingTap) && (
            <button onClick={close} style={{ ...rowStyle('rgba(255,255,255,0.35)'), fontSize: 10 }}>
              {showKinds ? 'BACK' : 'CANCEL'}
            </button>
          )}
        </div>
      )}

      {/* Main VPS button */}
      <button
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label="VPS — report a police unit or camera"
        style={{
          ...base,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 60,
          height: 60,
          borderRadius: 12,
          gap: 1,
          fontWeight: 700,
          background: confirm ? 'rgba(45,140,255,0.15)' : open ? 'rgba(255,45,45,0.2)' : 'rgba(255,45,45,0.12)',
          border: `1.5px solid ${confirm ? 'var(--vp-cyan)' : 'var(--vp-red)'}`,
          color: confirm ? 'var(--vp-cyan)' : 'var(--vp-red)',
          boxShadow: `0 0 16px ${confirm ? 'rgba(45,140,255,0.3)' : 'rgba(255,45,45,0.25)'}`,
        }}
      >
        {confirm ? (
          <>
            <span style={{ fontSize: 16, lineHeight: 1 }}>✓</span>
            <span style={{ fontSize: 8 }}>SENT</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 14, lineHeight: 1 }}>{open ? '✕' : '⚠'}</span>
            <span style={{ fontSize: 11, lineHeight: 1 }}>VPS</span>
            <span style={{ fontSize: 7, opacity: 0.7 }}>{open ? 'CLOSE' : 'REPORT'}</span>
          </>
        )}
      </button>
    </div>
  )
}
