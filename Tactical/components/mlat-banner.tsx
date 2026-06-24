'use client'

/**
 * MlatBanner (v2, vp-theme styling, adapted to live mlatCount/modeSCount props)
 * "Blind Sky" awareness — shown when aircraft are MLAT-only or Mode-S-only.
 * The outer container is positioned by the wrapper in page.tsx; this renders
 * the vp-styled visual (not .vp-mlat-banner, which self-positions).
 */

interface MlatBannerProps {
  mlatCount: number
  modeSCount: number
  expanded?: boolean
  onToggle?: () => void
}

export function MlatBanner({ mlatCount, modeSCount, onToggle }: MlatBannerProps) {
  if (mlatCount === 0 && modeSCount === 0) return null
  const hasBlind = modeSCount > 0

  return (
    <div
      role="alert"
      style={{
        background: 'rgba(8,14,24,0.92)',
        border: `1px solid ${hasBlind ? 'rgba(255,45,45,0.3)' : 'rgba(255,170,0,0.25)'}`,
        borderRadius: 6,
        padding: '8px 12px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="vp-mlat-banner-title" style={hasBlind ? { color: 'var(--vp-red)' } : undefined}>
        ⚠ {hasBlind ? 'BLIND SKY WARNING' : 'MLAT POSITION ONLY'}
      </div>
      <div className="vp-mlat-banner-body">
        {modeSCount > 0 && <>{modeSCount} Mode-S only — no position. </>}
        {mlatCount > 0 && <>{mlatCount} MLAT (±300m). </>}
        Absence of a marker does not mean clear sky.
      </div>
      {onToggle && (
        <button className="vp-mlat-dismiss" onClick={onToggle}>DISMISS</button>
      )}
    </div>
  )
}
