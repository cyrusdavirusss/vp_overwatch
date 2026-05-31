// Map glyph SVGs for VP-Overwatch markers.
//
// The shapes are the locked, purpose-built marker art from assets/markers/.
// Aircraft silhouettes are aviation amber (active-aircraft doctrine) and are
// rotated to heading by the marker element, not here. Ground-report glyphs are
// recoloured by status: CONFIRMED threats use threat red, single-source
// "Reported" units use the softer green state (README status vocabulary).

import type { Aircraft, Report } from '@/lib/data'

export const AMBER = '#FFB020' // active aircraft
export const RED = '#FF4757' // confirmed ground threat
export const GREEN = '#5BD68A' // reported / unconfirmed (softer state)
export const INK0 = '#0A0B0D' // marker base fill

// ── Aircraft silhouettes (assets/markers/rotary.svg, fixedwing.svg) ──────────
// Both point north (up) at heading 0; the marker element applies rotation.

function rotarySVG(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <ellipse cx="12" cy="9" rx="10" ry="2" stroke="${AMBER}" stroke-width="0.6" opacity="0.45"></ellipse>
  <path d="M12 3 L17 18 L12 15 L7 18 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.5"></path>
  <rect x="11.4" y="14" width="1.2" height="6" fill="${AMBER}"></rect>
  <line x1="9" y1="19.5" x2="15" y2="19.5" stroke="${AMBER}" stroke-width="1" opacity="0.7"></line>
</svg>`
}

function fixedwingSVG(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <path d="M12 2 L13.2 20 L12 22 L10.8 20 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.4"></path>
  <path d="M3 13 L11 11 L11 14 L3 16 Z" fill="${AMBER}"></path>
  <path d="M21 13 L13 11 L13 14 L21 16 Z" fill="${AMBER}"></path>
  <path d="M8 19 L11.4 18.5 L11.4 20 L8 20.5 Z" fill="${AMBER}"></path>
  <path d="M16 19 L12.6 18.5 L12.6 20 L16 20.5 Z" fill="${AMBER}"></path>
</svg>`
}

export function aircraftMarkerSVG(role: Aircraft['role'], size: number): string {
  return role === 'rotary' ? rotarySVG(size) : fixedwingSVG(size)
}

// ── Ground-report glyphs (assets/markers/*.svg), {C} = status colour ─────────

const REPORT_TEMPLATES: Record<Report['kind'], string> = {
  marked: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5"></circle>
  <path d="M6.5 13.5 L7.5 10 L16.5 10 L17.5 13.5 L17.5 15.5 L6.5 15.5 Z" fill="{C}"></path>
  <rect x="8" y="11" width="3.5" height="2" rx="0.3" fill="${INK0}"></rect>
  <rect x="12.5" y="11" width="3.5" height="2" rx="0.3" fill="${INK0}"></rect>
  <circle cx="8.5" cy="15.5" r="1.2" fill="${INK0}"></circle>
  <circle cx="15.5" cy="15.5" r="1.2" fill="${INK0}"></circle>`,

  unmarked: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5" stroke-dasharray="2 1.5"></circle>
  <path d="M6.5 13.5 L7.5 10 L16.5 10 L17.5 13.5 L17.5 15.5 L6.5 15.5 Z" fill="{C}" opacity="0.85"></path>
  <rect x="8" y="11" width="3.5" height="2" rx="0.3" fill="${INK0}"></rect>
  <rect x="12.5" y="11" width="3.5" height="2" rx="0.3" fill="${INK0}"></rect>`,

  hidden: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5"></circle>
  <path d="M5 12 C7 8.5 9.5 7.5 12 7.5 C14.5 7.5 17 8.5 19 12 C17 15.5 14.5 16.5 12 16.5 C9.5 16.5 7 15.5 5 12 Z" stroke="{C}" stroke-width="1.4" fill="none"></path>
  <circle cx="12" cy="12" r="2" fill="{C}"></circle>`,

  stop: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5"></circle>
  <path d="M12 6 L18 17 L6 17 Z" stroke="{C}" stroke-width="1.5" fill="none" stroke-linejoin="round"></path>
  <rect x="11.4" y="9.5" width="1.2" height="4" fill="{C}"></rect>
  <circle cx="12" cy="15" r="0.8" fill="{C}"></circle>`,

  checkpoint: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5"></circle>
  <line x1="6" y1="14" x2="18" y2="9" stroke="{C}" stroke-width="1.8" stroke-linecap="round"></line>
  <circle cx="6" cy="14" r="1.6" fill="{C}"></circle>
  <line x1="6" y1="14" x2="6" y2="18" stroke="{C}" stroke-width="1.5" stroke-linecap="round"></line>`,

  rbt: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5"></circle>
  <rect x="6.5" y="9.5" width="11" height="3.6" rx="0.5" fill="{C}"></rect>
  <rect x="16.2" y="10.4" width="2" height="1.8" rx="0.3" fill="${INK0}"></rect>
  <path d="M 12 13.5 L 12 16 L 14 17.5" stroke="{C}" stroke-width="1.4" stroke-linecap="round" fill="none"></path>
  <text x="9.5" y="11.7" font-family="'JetBrains Mono', monospace" font-size="2.6" font-weight="700" letter-spacing="0.04em" fill="${INK0}" text-anchor="middle">R</text>`,

  camera: `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5"></circle>
  <rect x="6" y="9" width="10" height="7" rx="0.8" fill="{C}"></rect>
  <circle cx="11" cy="12.5" r="2.2" fill="${INK0}"></circle>
  <circle cx="11" cy="12.5" r="1.1" fill="{C}"></circle>
  <rect x="13.5" y="7.6" width="2.2" height="1.6" rx="0.2" fill="{C}"></rect>
  <rect x="11.4" y="16" width="1.2" height="2.5" fill="{C}"></rect>
  <path d="M 9.5 18.5 L 14.5 18.5" stroke="{C}" stroke-width="1.4" stroke-linecap="round"></path>`,
}

export function reportMarkerSVG(
  kind: Report['kind'],
  color: string,
  size: number
): string {
  const inner = (REPORT_TEMPLATES[kind] ?? REPORT_TEMPLATES.marked).replaceAll(
    '{C}',
    color
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${inner}</svg>`
}
