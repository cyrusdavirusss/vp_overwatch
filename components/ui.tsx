'use client'

import { cn } from '@/lib/utils'

interface ChipProps {
  variant: 'live' | 'aircraft' | 'threat' | 'confirm' | 'stale'
  children: React.ReactNode
  className?: string
}

export function Chip({ variant, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        'chip',
        variant === 'live' && 'chip-live',
        variant === 'aircraft' && 'chip-aircraft',
        variant === 'threat' && 'chip-threat',
        variant === 'confirm' && 'chip-confirm',
        variant === 'stale' && 'chip-stale',
        className
      )}
    >
      {children}
    </span>
  )
}

interface DotProps {
  pulse?: boolean
  className?: string
}

export function Dot({ pulse = false, className }: DotProps) {
  return <span className={cn('dot', pulse && 'dot-pulse', className)} />
}

interface MetricProps {
  label: string
  value: string
  unit?: string
  trend?: 'climb' | 'descend' | 'level'
  tone?: 'default' | 'green' | 'amber' | 'red'
  mono?: boolean
  className?: string
}

export function Metric({
  label,
  value,
  unit,
  trend,
  tone = 'default',
  mono = true,
  className,
}: MetricProps) {
  return (
    <div className={cn('bg-ink-2 px-3 py-2.5', className)}>
      <div className="font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-fg-3 mb-1">
        {label}
      </div>
      <div
        className={cn(
          'text-xl font-semibold leading-none tracking-[-0.01em] flex items-center gap-1',
          mono && 'num',
          tone === 'default' && 'text-fg-1',
          tone === 'green' && 'text-[var(--green)]',
          tone === 'amber' && 'text-[var(--amber)]',
          tone === 'red' && 'text-[var(--red)]'
        )}
      >
        {value}
        {trend === 'climb' && (
          <span className="text-[var(--green)] text-sm">↑</span>
        )}
        {trend === 'descend' && (
          <span className="text-[var(--amber)] text-sm">↓</span>
        )}
      </div>
      {unit && (
        <div className="font-mono text-[10px] text-fg-3 mt-0.5 tracking-[0.02em]">
          {unit}
        </div>
      )}
    </div>
  )
}

interface SwitchProps {
  checked: boolean
  onChange?: () => void
}

export function Switch({ checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0',
        checked ? 'bg-[var(--blue)]' : 'bg-ink-3'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full transition-[left]',
          checked ? 'left-4' : 'left-0.5'
        )}
        style={{ transitionDuration: 'var(--dur-hover)' }}
      />
    </button>
  )
}

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  label?: string
}

export function Slider({ value, min, max, step, onChange, label }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 relative h-1 bg-ink-3 rounded-full">
        <div
          className="absolute top-0 left-0 bottom-0 bg-[var(--blue)] rounded-full"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 -top-2.5 -bottom-2.5 w-full h-6 opacity-0 cursor-pointer"
        />
      </div>
      {label && (
        <span className="num text-xs font-semibold text-fg-1 tracking-[0.02em] min-w-10 text-right">
          {label}
        </span>
      )}
    </div>
  )
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon'
  children: React.ReactNode
}

export function Button({
  variant = 'secondary',
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md font-medium text-[13px] transition-all cursor-pointer',
        'active:scale-[0.98]',
        variant === 'primary' &&
          'bg-[var(--blue)] text-white hover:bg-[var(--blue-hi)]',
        variant === 'secondary' &&
          'bg-ink-3 text-fg-1 border border-border hover:bg-ink-4',
        variant === 'ghost' &&
          'bg-transparent text-fg-2 hover:bg-ink-3 hover:text-fg-1',
        variant === 'icon' && 'w-9 h-9 p-0',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        'bg-ink-2 border border-border rounded-md p-3',
        className
      )}
    >
      {children}
    </div>
  )
}
