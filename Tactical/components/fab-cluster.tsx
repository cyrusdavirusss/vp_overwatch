'use client'

import { Icon } from './icon'

interface FabClusterProps {
  onLayers: () => void
  onFilters: () => void
  onRecenter: () => void
  onSetLocation: () => void
  followUser?: boolean
  onFitAll: () => void
  onAR?: () => void
  onRoute?: () => void
}

export function FabCluster({
  onLayers,
  onFilters,
  onRecenter,
  onSetLocation,
  followUser,
  onFitAll,
  onAR,
  onRoute,
}: FabClusterProps) {
  return (
    <div className="absolute right-3 bottom-3 flex flex-col gap-2 z-10">
      {onAR && (
        <FabBtn onClick={onAR} label="Paranoid Mode (AR Camera)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </FabBtn>
      )}
      {onRoute && (
        <FabBtn onClick={onRoute} label="Set Destination / Route Watch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </FabBtn>
      )}
      <FabBtn onClick={onSetLocation} label="Set Location">
        <Icon name="pin" size={18} />
      </FabBtn>
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
      className={`relative w-11 h-11 rounded-md flex items-center justify-center cursor-pointer transition-all active:scale-[0.94] ${
        primary
          ? 'bg-[var(--blue)] text-white border-[var(--blue)] hover:bg-[var(--blue-hi)]'
          : 'bg-ink-1/90 text-fg-1 border border-border hover:bg-ink-3'
      }`}
      style={{
        backdropFilter: !primary ? 'blur(14px)' : undefined,
        WebkitBackdropFilter: !primary ? 'blur(14px)' : undefined,
        boxShadow: 'var(--shadow-fab)',
      }}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  )
}
