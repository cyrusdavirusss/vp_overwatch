// Lucide-style icons, inline SVG, currentColor.
// Stroke 1.75 for tighter optical balance at small sizes.
// Usage: <Icon name="layers" size={18} />

const ICON_PATHS = {
  layers: 'M12 2 L2 7 L12 12 L22 7 Z M2 12 L12 17 L22 12 M2 17 L12 22 L22 17',
  filter: 'M3 6 H21 M6 12 H18 M10 18 H14',
  crosshair: 'M12 22 V18 M12 6 V2 M22 12 H18 M6 12 H2 M19 12 A7 7 0 1 1 12 5 A7 7 0 0 1 19 12',
  navigation: 'M3 11 L22 2 L13 21 L11 13 Z',
  chevronUp: 'M6 15 L12 9 L18 15',
  chevronDown: 'M6 9 L12 15 L18 9',
  chevronLeft: 'M15 18 L9 12 L15 6',
  chevronRight: 'M9 18 L15 12 L9 6',
  close: 'M18 6 L6 18 M6 6 L18 18',
  search: 'M11 19 A8 8 0 1 1 19 11 A8 8 0 0 1 11 19 Z M21 21 L16.65 16.65',
  radio: 'M4.93 19.07 A10 10 0 0 1 4.93 4.93 M7.76 16.24 A6 6 0 0 1 7.76 7.76 M19.07 4.93 A10 10 0 0 1 19.07 19.07 M16.24 7.76 A6 6 0 0 1 16.24 16.24 M12 13 A1 1 0 1 0 12 11 A1 1 0 0 0 12 13 Z',
  alert: 'M12 9 V13 M12 17 H12.01 M10.29 3.86 L1.82 18 A2 2 0 0 0 3.55 21 H20.45 A2 2 0 0 0 22.18 18 L13.71 3.86 A2 2 0 0 0 10.29 3.86 Z',
  helicopter: 'M5 8 H19 M12 8 V14 M9 14 H15 M7 17 H17 M11 14 V17 M13 14 V17 M12 5 V8',
  plane: 'M17.8 19.2 L16 11 L8.59 12.42 M21 8 L7 22 L6 11 L4 9 V5 L21 8 Z',
  car: 'M19 17 H5 V13 L7 7 H17 L19 13 Z M7.5 17 V19 M16.5 17 V19 M5 13 H19',
  eye: 'M2 12 S5 5 12 5 S22 12 22 12 S19 19 12 19 S2 12 2 12 Z M15 12 A3 3 0 1 1 12 9 A3 3 0 0 1 15 12',
  pause: 'M6 4 H10 V20 H6 Z M14 4 H18 V20 H14 Z',
  play: 'M5 3 L19 12 L5 21 Z',
  clock: 'M12 22 A10 10 0 1 1 22 12 A10 10 0 0 1 12 22 Z M12 6 V12 L16 14',
  signal: 'M2 22 V14 M9 22 V10 M16 22 V6 M22.5 22 V2',
  satellite: 'M5 5 L9.5 9.5 M14.5 14.5 L19 19 M9 12 A3 3 0 1 1 12 9 M15 5 L19 9 L21 7 L17 3 Z M5 17 L9 21 L7 23 L3 19 Z',
  pin: 'M12 22 S5 16.5 5 10 A7 7 0 1 1 19 10 C19 16.5 12 22 12 22 Z M12 13 A3 3 0 1 1 15 10 A3 3 0 0 1 12 13 Z',
  arrow: 'M5 12 H19 M13 6 L19 12 L13 18',
  arrowUp: 'M12 19 V5 M5 12 L12 5 L19 12',
  arrowDown: 'M12 5 V19 M5 12 L12 19 L19 12',
  arrowDownRight: 'M7 7 L17 17 M17 7 H17 V17',
  more: 'M5 12 A1 1 0 1 1 5 14 A1 1 0 0 1 5 12 Z M11 12 A1 1 0 1 1 11 14 A1 1 0 0 1 11 12 Z M17 12 A1 1 0 1 1 17 14 A1 1 0 0 1 17 12 Z',
  sun: 'M12 17 A5 5 0 1 1 12 7 A5 5 0 0 1 12 17 Z M12 1 V3 M12 21 V23 M4.22 4.22 L5.64 5.64 M18.36 18.36 L19.78 19.78 M1 12 H3 M21 12 H23 M4.22 19.78 L5.64 18.36 M18.36 5.64 L19.78 4.22',
  moon: 'M21 12.79 A9 9 0 1 1 11.21 3 A7 7 0 0 0 21 12.79 Z',
  triangleDown: 'M12 17 L5 9 H19 Z',
  triangleUp: 'M12 7 L19 15 H5 Z',
};

function Icon({ name, size = 20, stroke = 1.75, fill = 'none', className = '', style = {}, ...rest }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`vp-icon ${className}`}
      style={style}
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

window.Icon = Icon;
