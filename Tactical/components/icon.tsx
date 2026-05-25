'use client'

import {
  Layers,
  Filter,
  Crosshair,
  Navigation,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Search,
  Radio,
  AlertTriangle,
  Car,
  Eye,
  Pause,
  Play,
  Clock,
  Signal,
  Satellite,
  MapPin,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowDownRight,
  MoreHorizontal,
  Sun,
  Moon,
  Plane,
  LucideIcon,
} from 'lucide-react'

// Custom helicopter icon since Lucide doesn't have one
const Helicopter = ({
  size = 20,
  strokeWidth = 1.75,
  ...props
}: {
  size?: number
  strokeWidth?: number
} & React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M5 8 H19 M12 8 V14 M9 14 H15 M7 17 H17 M11 14 V17 M13 14 V17 M12 5 V8" />
  </svg>
)

const iconMap: Record<string, LucideIcon | typeof Helicopter> = {
  layers: Layers,
  filter: Filter,
  crosshair: Crosshair,
  navigation: Navigation,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  close: X,
  search: Search,
  radio: Radio,
  alert: AlertTriangle,
  helicopter: Helicopter,
  plane: Plane,
  car: Car,
  eye: Eye,
  pause: Pause,
  play: Play,
  clock: Clock,
  signal: Signal,
  satellite: Satellite,
  pin: MapPin,
  arrow: ArrowRight,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  arrowDownRight: ArrowDownRight,
  more: MoreHorizontal,
  sun: Sun,
  moon: Moon,
}

interface IconProps {
  name: string
  size?: number
  strokeWidth?: number
  className?: string
  fill?: string
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className = '',
  fill = 'none',
}: IconProps) {
  const IconComponent = iconMap[name]
  if (!IconComponent) return null

  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      fill={fill}
    />
  )
}
