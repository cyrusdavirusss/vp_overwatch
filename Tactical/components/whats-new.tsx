'use client'

import { useEffect } from 'react'
import { WHATS_NEW } from '@/lib/whats-new'

/**
 * The What's New panel.
 *
 * Deliberately NOT a modal with a scrim. This is a reference the operator may want
 * open beside the map while they try the thing it describes, so it is a dismissible
 * panel in the corner: it does not block the map, does not trap focus, and closes on
 * Escape, on the close button, or on a click outside.
 *
 * Styling follows the app's existing rules: ink surfaces, Signal Blue chrome, mono
 * caps for labels, no emoji, no gradients outside map terrain.
 */
export function WhatsNewPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="vp-whats-new"
      role="dialog"
      aria-label="What's new"
      style={{
        position: 'fixed',
        bottom: 76,
        left: 16,
        zIndex: 40,
        width: 'min(380px, calc(100vw - 32px))',
        maxHeight: 'min(70vh, 560px)',
        overflowY: 'auto',
        background: 'var(--ink-1, #101215)',
        border: '1px solid rgba(45,140,255,0.38)',
        borderRadius: 12,
        boxShadow: '0 12px 34px rgba(0,0,0,0.55)',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '11px 14px',
          background: 'var(--ink-1, #101215)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.16em',
            color: 'var(--blue-hi, #6fa8ff)',
          }}
        >
          WHAT&apos;S NEW
        </span>
        <button
          onClick={onClose}
          aria-label="Close what's new"
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 6,
            color: 'inherit',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 10,
            letterSpacing: '0.1em',
            padding: '3px 8px',
          }}
        >
          CLOSE
        </button>
      </div>

      <div style={{ padding: '4px 14px 14px' }}>
        {WHATS_NEW.map((entry) => (
          <div key={entry.title} style={{ padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: 'var(--blue, #4d7cff)',
                marginBottom: 5,
              }}
            >
              {entry.title}
            </div>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, opacity: 0.88 }}>{entry.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
