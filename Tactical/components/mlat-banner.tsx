'use client'

/**
 * MlatBanner — "Blind Sky" awareness notice
 *
 * Displayed when one or more known police aircraft are only visible via
 * MLAT (multilateration) or Mode-S only (no position at all).
 *
 * The core message: absence of a bubble does NOT mean clear sky.
 * Mode-S only aircraft are detected by receivers but cannot be positioned
 * without cooperative transponder data or enough MLAT receivers in range.
 */

interface MlatBannerProps {
  /** Aircraft that are MLAT-only (position is approximate) */
  mlatCount: number
  /** Aircraft that are Mode-S only (no position available at all) */
  modeSCount: number
  /** Whether to show the expanded explanation */
  expanded?: boolean
  onToggle?: () => void
}

export function MlatBanner({ mlatCount, modeSCount, expanded = false, onToggle }: MlatBannerProps) {
  if (mlatCount === 0 && modeSCount === 0) return null

  const total = mlatCount + modeSCount
  const hasBlind = modeSCount > 0

  return (
    <div
      className="flex flex-col gap-0 overflow-hidden rounded-lg border cursor-pointer select-none"
      style={{
        background: hasBlind
          ? 'color-mix(in srgb, var(--red) 10%, var(--ink-1))'
          : 'color-mix(in srgb, var(--amber) 10%, var(--ink-1))',
        borderColor: hasBlind ? 'color-mix(in srgb, var(--red) 35%, transparent)' : 'color-mix(in srgb, var(--amber) 35%, transparent)',
      }}
      onClick={onToggle}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Animated warning dot */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
          style={{ background: hasBlind ? 'var(--red)' : 'var(--amber)' }}
        />

        <div className="flex-1 min-w-0">
          <span
            className="font-mono text-[10px] font-bold tracking-[0.1em] uppercase"
            style={{ color: hasBlind ? 'var(--red)' : 'var(--amber)' }}
          >
            {hasBlind ? 'BLIND SKY WARNING' : 'MLAT POSITION ONLY'}
          </span>
          <span className="font-mono text-[10px] text-fg-3 ml-2">
            {modeSCount > 0 && `${modeSCount} unit${modeSCount > 1 ? 's' : ''} unlocatable`}
            {modeSCount > 0 && mlatCount > 0 && ' · '}
            {mlatCount > 0 && `${mlatCount} MLAT (±300m)`}
          </span>
        </div>

        {/* Expand chevron */}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          className="text-fg-3 flex-shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded explanation */}
      {expanded && (
        <div
          className="px-3 pb-3 text-[11px] leading-relaxed text-fg-2 border-t"
          style={{ borderColor: hasBlind ? 'color-mix(in srgb, var(--red) 20%, transparent)' : 'color-mix(in srgb, var(--amber) 20%, transparent)' }}
        >
          <p className="mt-2">
            {hasBlind && (
              <>
                <span className="font-semibold" style={{ color: 'var(--red)' }}>
                  {modeSCount} aircraft {modeSCount === 1 ? 'is' : 'are'} Mode-S only.
                </span>{' '}
                This means receivers can detect the transponder squitter but cannot calculate a position.
                The aircraft exists — it is not on the map.{' '}
              </>
            )}
            {mlatCount > 0 && (
              <>
                <span className="font-semibold" style={{ color: 'var(--amber)' }}>
                  {mlatCount} aircraft {mlatCount === 1 ? 'is' : 'are'} MLAT-positioned.
                </span>{' '}
                Position is calculated from time-difference-of-arrival across multiple receivers.
                Accuracy is typically ±300m and altitude is unreliable.{' '}
              </>
            )}
            <span className="text-fg-3">
              Absence of a bubble on the map does not mean clear sky.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
