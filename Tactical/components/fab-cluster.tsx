'use client'

import { Icon } from './icon'

interface FabClusterProps {
  onLayers: () => void
  onFilters: () => void
  onRecenter: () => void
  onSetLocation?: () => void
  followUser?: boolean
  onFitAll: () => void
  onRoute?: () => void
  /** Head-up mode: rotate the map to the direction the phone is facing. */
  onHeading?: () => void
  headingActive?: boolean
  /** Live compass heading, for the needle. Null while unavailable. */
  heading?: number | null
}

export function FabCluster({
  onLayers,
  onFilters,
  onRecenter,
  onSetLocation,
  followUser,
  onFitAll,
  onRoute,
  onHeading,
  headingActive,
  heading,
}: FabClusterProps) {
  return (
    <div className="vp-fab-cluster">
      {onRoute && (
        <FabBtn onClick={onRoute} label="Set Destination / Route Watch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </FabBtn>
      )}
      {onSetLocation && (
        <FabBtn onClick={onSetLocation} label="Set Location">
          <Icon name="pin" size={18} />
        </FabBtn>
      )}
      <FabBtn onClick={onFitAll} label="Fit All Aircraft">
        <Icon name="maximize" size={18} />
      </FabBtn>
      <FabBtn onClick={onLayers} label="Layers">
        <Icon name="layers" size={18} />
      </FabBtn>
      <FabBtn onClick={onFilters} label="Filter">
        <Icon name="filter" size={18} />
      </FabBtn>
      <FabBtn onClick={onRecenter} primary label="Recenter">
        <Icon name="crosshair" size={18} />
        {followUser && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[var(--green)] border-2 border-ink-0 rounded-full" />
        )}
      </FabBtn>
      {/* Head-up mode. Only offered where the device actually reports orientation
          (the prop is omitted on desktop), and the needle turns with the live
          heading so the control shows what the map is doing. */}
      {onHeading && (
        <FabBtn onClick={onHeading} primary={headingActive} label={headingActive ? 'Head-up: on (tap for north-up)' : 'Head-up: rotate map to phone'}>
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{
              transform: `rotate(${headingActive && heading != null ? -heading : 0}deg)`,
              transition: headingActive ? 'transform 120ms linear' : 'transform 200ms ease',
            }}
          >
            <circle cx="12" cy="12" r="9" />
            <polygon points="12 4.5 14.2 12 12 12" fill="currentColor" stroke="none" />
            <polygon points="12 19.5 9.8 12 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          {headingActive && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[var(--green)] border-2 border-ink-0 rounded-full" />}
        </FabBtn>
      )}
    </div>
  )
}

interface FabBtnProps {
  onClick: () => void
  label: string
  primary?: boolean
  children: React.ReactNode
}

function FabBtn({ onClick, label, primary, children }: FabBtnProps) {
  return (
    <button
      className={`vp-fab ${primary ? 'vp-fab--active' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
