'use client'

import { Icon } from './icon'
import { Switch, Slider } from './ui'

export interface Filters {
  aircraft: boolean
  reports: boolean
  trails: boolean
  predictive: boolean
  heatmap: boolean
  rotary: boolean
  fixedwing: boolean
  kind_marked: boolean
  kind_unmarked: boolean
  kind_hidden: boolean
  kind_stop: boolean
  kind_checkpoint: boolean
  kind_rbt: boolean
  kind_camera: boolean
  radius: number
  windowMin: number
}

interface FilterPanelProps {
  filters: Filters
  onFilterChange: (filters: Filters) => void
  onClose: () => void
}

export function FilterPanel({ filters, onFilterChange, onClose }: FilterPanelProps) {
  const toggle = (key: keyof Filters) => () =>
    onFilterChange({ ...filters, [key]: !filters[key] })

  const setKey = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onFilterChange({ ...filters, [key]: value })

  return (
    <div
      className="bg-ink-1 border border-border rounded-lg p-4 mx-3 max-h-[calc(100%-88px)] overflow-y-auto"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg-1">
          <Icon name="layers" size={16} />
          <span>Layers &amp; Filters</span>
        </div>
        <button
          className="w-8 h-8 flex items-center justify-center bg-ink-2 border border-border text-fg-2 rounded-md hover:bg-ink-3 hover:text-fg-1 transition-colors"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      {/* Layers */}
      <Section label="Layers">
        <ToggleRow
          label="Aircraft"
          sub="ADS-B feed"
          checked={filters.aircraft}
          onChange={toggle('aircraft')}
        />
        <ToggleRow
          label="Ground reports"
          sub="Waze pipeline"
          checked={filters.reports}
          onChange={toggle('reports')}
        />
        <ToggleRow
          label="Aircraft trails"
          sub="fading 4m"
          checked={filters.trails}
          onChange={toggle('trails')}
        />
        <ToggleRow
          label="Predictive vector"
          sub="60-90s forward"
          checked={filters.predictive}
          onChange={toggle('predictive')}
        />
      </Section>

      {/* Aircraft types */}
      <Section label="Aircraft types">
        <ChipRow>
          <ChipToggle
            active={filters.rotary}
            onClick={() => setKey('rotary', !filters.rotary)}
          >
            <Icon name="helicopter" size={12} strokeWidth={1.5} /> Rotary
          </ChipToggle>
          <ChipToggle
            active={filters.fixedwing}
            onClick={() => setKey('fixedwing', !filters.fixedwing)}
          >
            <Icon name="plane" size={12} strokeWidth={1.5} /> Fixed-wing
          </ChipToggle>
        </ChipRow>
      </Section>

      {/* Report types */}
      <Section label="Report types">
        <ChipRow>
          <ChipToggle
            active={filters.kind_marked}
            onClick={() => setKey('kind_marked', !filters.kind_marked)}
          >
            Marked
          </ChipToggle>
          <ChipToggle
            active={filters.kind_unmarked}
            onClick={() => setKey('kind_unmarked', !filters.kind_unmarked)}
          >
            Unmarked
          </ChipToggle>
          <ChipToggle
            active={filters.kind_hidden}
            onClick={() => setKey('kind_hidden', !filters.kind_hidden)}
          >
            Hidden
          </ChipToggle>
          <ChipToggle
            active={filters.kind_stop}
            onClick={() => setKey('kind_stop', !filters.kind_stop)}
          >
            Stop
          </ChipToggle>
          <ChipToggle
            active={filters.kind_checkpoint}
            onClick={() => setKey('kind_checkpoint', !filters.kind_checkpoint)}
          >
            Checkpoint
          </ChipToggle>
          <ChipToggle
            active={filters.kind_rbt}
            onClick={() => setKey('kind_rbt', !filters.kind_rbt)}
          >
            RBT
          </ChipToggle>
          <ChipToggle
            active={filters.kind_camera}
            onClick={() => setKey('kind_camera', !filters.kind_camera)}
          >
            Camera
          </ChipToggle>
        </ChipRow>
      </Section>

      {/* Radius */}
      <Section label="Radius">
        <Slider
          value={filters.radius}
          min={1}
          max={25}
          step={1}
          onChange={(v) => setKey('radius', v)}
          label={`${filters.radius}nm`}
        />
      </Section>

      {/* Time window */}
      <Section label="Time window">
        <ChipRow>
          {[15, 30, 60, 120].map((m) => (
            <ChipToggle
              key={m}
              active={filters.windowMin === m}
              onClick={() => setKey('windowMin', m)}
            >
              {m}m
            </ChipToggle>
          ))}
        </ChipRow>
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3 mb-2">
        {label}
      </div>
      {children}
    </div>
  )
}

interface ToggleRowProps {
  label: string
  sub?: string
  checked: boolean
  onChange: () => void
}

function ToggleRow({ label, sub, checked, onChange }: ToggleRowProps) {
  return (
    <div
      className="flex items-center justify-between py-2 border-b border-border-subtle last:border-b-0 cursor-pointer hover:bg-ink-2 -mx-2 px-2 rounded transition-colors"
      onClick={onChange}
    >
      <div className="flex flex-col gap-0.5">
        <div className="text-[13px] text-fg-1">{label}</div>
        {sub && (
          <div className="font-mono text-[10px] text-fg-3 tracking-[0.02em]">{sub}</div>
        )}
      </div>
      <Switch checked={checked} />
    </div>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

interface ChipToggleProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function ChipToggle({ active, onClick, children }: ChipToggleProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] font-medium transition-colors ${
        active
          ? 'bg-[var(--blue-wash)] border border-[var(--blue)] text-[var(--blue)]'
          : 'bg-ink-2 border border-border text-fg-2 hover:bg-ink-3 hover:text-fg-1'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
