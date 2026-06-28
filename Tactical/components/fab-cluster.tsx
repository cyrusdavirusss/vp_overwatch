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
}

export function FabCluster({
  onLayers,
  onFilters,
  onRecenter,
  onSetLocation,
  followUser,
  onFitAll,
  onRoute,
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
