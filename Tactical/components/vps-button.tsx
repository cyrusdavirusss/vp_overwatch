'use client'

/**
 * VPSButton — "Victoria Police Spotted" community report control.
 * Standalone left-side map button that expands to three report kinds.
 * Tapping a kind drops a community ground report at the user's location.
 */

import { useState } from 'react'

type Kind = 'marked' | 'unmarked' | 'hidden'

interface VPSButtonProps {
  onReport: (kind: Kind) => void
}

const OPTIONS: { kind: Kind; label: string; color: string }[] = [
  { kind: 'marked', label: 'Marked Unit', color: 'var(--vp-red)' },
  { kind: 'unmarked', label: 'Unmarked Unit', color: 'var(--vp-amber)' },
  { kind: 'hidden', label: 'Hidden Cam / Unit', color: 'var(--vp-purple)' },
]

const base: React.CSSProperties = {
  fontFamily: "'Space Mono', monospace",
  letterSpacing: '0.1em',
  cursor: 'pointer',
  userSelect: 'none',
  backdropFilter: 'blur(8px)',
  transition: 'all 160ms ease',
}

export function VPSButton({ onReport }: VPSButtonProps) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const pick = (kind: Kind) => {
    onReport(kind)
    setOpen(false)
    setConfirm(true)
    window.setTimeout(() => setConfirm(false), 2400)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      {/* Options appear above the main button */}
      {open &&
        OPTIONS.map((o) => (
          <button
            key={o.kind}
            onClick={() => pick(o.kind)}
            style={{
              ...base,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              background: 'rgba(8,14,24,0.92)',
              border: `1px solid ${o.color}`,
              color: o.color,
              boxShadow: `0 0 12px ${o.color}33`,
              whiteSpace: 'nowrap',
              animation: 'vp-fade-in 200ms ease',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.color, boxShadow: `0 0 6px ${o.color}` }} />
            {o.label}
          </button>
        ))}

      {/* Main VPS button */}
      <button
        onClick={() => setOpen((v) => !v)}
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
          background: confirm ? 'rgba(0,212,255,0.15)' : open ? 'rgba(255,45,45,0.2)' : 'rgba(255,45,45,0.12)',
          border: `1.5px solid ${confirm ? 'var(--vp-cyan)' : 'var(--vp-red)'}`,
          color: confirm ? 'var(--vp-cyan)' : 'var(--vp-red)',
          boxShadow: `0 0 16px ${confirm ? 'rgba(0,212,255,0.3)' : 'rgba(255,45,45,0.25)'}`,
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
