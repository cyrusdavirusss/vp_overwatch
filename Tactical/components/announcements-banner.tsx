'use client'

/**
 * Operator announcements — a dismissible notice above the map.
 *
 * Dismissal is per-announcement, not a global mute: closing one notice must not
 * silently swallow the next one. The dismissed ids live in localStorage, so a
 * reload keeps them hidden, which is what "I've read that" should mean.
 *
 * Renders nothing at all when there is nothing live — no empty chrome, no skeleton.
 */
import { useEffect, useState } from 'react'

interface Announcement {
  id: number
  title: string
  body: string
  level: 'info' | 'notice' | 'warning' | 'critical'
  pinned: boolean
  publishedAt: number
}

const STORE_KEY = 'vp-dismissed-announcements'

// Amber and red here are the app's SEMANTIC colours (warning / alert), which is
// exactly what these two levels mean — this is not amber used as decoration.
const LEVEL_STYLE: Record<Announcement['level'], { color: string; label: string }> = {
  info:     { color: 'var(--blue)',     label: 'Notice' },
  notice:   { color: 'var(--chrome)',   label: 'Update' },
  warning:  { color: 'var(--vp-amber)', label: 'Warning' },
  critical: { color: 'var(--vp-red)',   label: 'Alert' },
}

function readDismissed(): number[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number') : []
  } catch {
    return []   // private mode / corrupt value: show announcements rather than break
  }
}

export function AnnouncementsBanner() {
  const [items, setItems] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<number[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setDismissed(readDismissed())
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/announcements', { cache: 'no-store' })
        const d = await r.json()
        if (alive && Array.isArray(d?.announcements)) setItems(d.announcements)
      } catch { /* the map matters more than the notice; stay quiet */ }
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const live = items.filter((a) => !dismissed.includes(a.id))
  if (live.length === 0) return null

  const shown = live[0]
  const others = live.length - 1
  const style = LEVEL_STYLE[shown.level] ?? LEVEL_STYLE.info

  const dismiss = (id: number) => {
    const next = [...dismissed, id]
    setDismissed(next)
    setExpanded(false)
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* non-fatal */ }
  }

  return (
    <div
      className="vp-announce rounded-md border px-2.5 py-1.5 flex items-start gap-2"
      style={{
        borderColor: style.color,
        background: 'color-mix(in srgb, var(--ink-1) 94%, transparent)',
        backdropFilter: 'blur(8px)',
        boxShadow: 'var(--shadow-fab, 0 2px 10px rgba(0,0,0,0.45))',
      }}
      role="status"
      aria-live="polite"
    >
      <span
        className="font-mono text-[9px] font-semibold tracking-[0.12em] uppercase shrink-0 mt-[2px]"
        style={{ color: style.color }}
      >
        {style.label}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="block w-full text-left font-mono text-[11px] text-[var(--text-1)] leading-snug"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {shown.title}
        </button>
        {expanded && (
          <p className="mt-1 font-mono text-[10px] text-[var(--text-2)] leading-relaxed whitespace-pre-wrap">
            {shown.body}
          </p>
        )}
        {others > 0 && (
          <span className="mt-0.5 block font-mono text-[9px] text-[var(--text-3)]">
            +{others} more notice{others === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(shown.id)}
        aria-label="Dismiss announcement"
        className="shrink-0 font-mono text-[12px] leading-none px-1 text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        ×
      </button>
    </div>
  )
}
