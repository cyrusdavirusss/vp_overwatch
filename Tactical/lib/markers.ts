// Map glyph SVGs for VP-Overwatch markers.
//
// Aircraft silhouettes are aviation cyan and are drawn to read at 36 px on a
// dark map, which is the size that actually matters. Two different conventions,
// chosen because they were tested at that size rather than guessed:
//
//   rotary     PROFILE chopper (side-on) with a blurred rotor disc on the mast.
//              A top-down helicopter was tried first and reads as a crosshair or
//              a drone at 36 px — a profile silhouette is what people recognise.
//              Being a profile, it does NOT rotate to heading (see map.tsx); the
//              predictive vector, trail and callout carry direction instead.
//   fixed wing TOP-DOWN silhouette, which stays unambiguous at 36 px and is
//              rotated to heading by the marker element.
//
// Ground-report glyphs are recoloured by status: CONFIRMED threats use threat
// red, single-source "Reported" units the softer blue (README status
// vocabulary). Each was redrawn after review of the previous set, which read as
// "a retro microbus", "a floating windshield", "an Allen key" and "a walkie-
// talkie" at size.

import type { Aircraft, Report } from '@/lib/data'

export const AMBER = '#00d4ff' // active aircraft (cyan — VP·Overwatch v2 theme)
export const RED = '#FF4757' // confirmed ground threat
export const GREEN = '#5BD68A' // reported / unconfirmed (softer state)
export const BLUE = '#1a6bff' // marked=red, unmarked/camera=blue (police kind colour)
export const INK0 = '#0A0B0D' // marker base fill

// ── Aircraft silhouettes ────────────────────────────────────────────────────

/**
 * Side-on helicopter, nose pointing right, with a motion-blurred rotor disc.
 *
 * The rotor is a DISC, not a bar: a bar frozen mid-rotation reads as a stray
 * diagonal line across the icon ("a beam glued to the roof drawn at a bizarre
 * angle"), whereas a translucent disc reads as rotation in every frame. The
 * faint sweep inside it (`.vp-rotor-sweep`, animated in globals.css) adds the
 * movement without ever escaping the disc outline.
 */
function rotarySVG(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <path d="M9.8 12.5 l-5.9 0.7 v1.4 l5.9 -0.55 z" fill="${AMBER}"></path>
  <path d="M3.9 12.6 l0 -2.3 l1.4 0.5 l0 2.4 z" fill="${AMBER}"></path>
  <ellipse cx="3.5" cy="11.5" rx="0.6" ry="1.55" fill="${AMBER}" opacity="0.55"></ellipse>
  <path d="M9.4 10.1 c2.0 -0.45 4.1 -0.35 5.9 0.5 c1.5 0.7 2.4 1.7 2.5 2.6 c0.05 0.9 -0.75 1.65 -2.2 2.05 c-1.6 0.45 -3.5 0.45 -5.9 0.05 z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.35"></path>
  <path d="M14 10.5 l3.6 2.2 l-3.6 1.5 z" fill="${INK0}" opacity="0.85"></path>
  <path d="M12.6 10.1 v-1.1" stroke="${AMBER}" stroke-width="0.85"></path>
  <ellipse cx="12.4" cy="8.4" rx="10.3" ry="1.75" fill="${AMBER}" opacity="0.16"></ellipse>
  <ellipse cx="12.4" cy="8.4" rx="9.6" ry="1.4" fill="${AMBER}" opacity="0.28"></ellipse>
  <g class="vp-rotor-sweep">
    <path d="M4.4 8.0 h16 a0.4 0.4 0 0 1 0 0.8 h-16 a0.4 0.4 0 0 1 0 -0.8 z" fill="${AMBER}" opacity="0.9"></path>
    <path d="M12.0 5.6 v5.6 a0.4 0.4 0 0 1 -0.8 0 v-5.6 a0.4 0.4 0 0 1 0.8 0 z" fill="${AMBER}" opacity="0.5"></path>
  </g>
  <ellipse cx="12.4" cy="8.4" rx="9.6" ry="0.42" fill="${AMBER}" opacity="0.5"></ellipse>
  <circle cx="12.4" cy="8.4" r="0.8" fill="${AMBER}"></circle>
  <circle cx="12.4" cy="8.4" r="0.3" fill="${INK0}"></circle>
  <path d="M8.4 17.5 h8.2" stroke="${AMBER}" stroke-width="1.15" stroke-linecap="round"></path>
  <path d="M10.3 16.1 v1.4 M14.8 16.1 v1.4" stroke="${AMBER}" stroke-width="0.75"></path>
</svg>`
}

function fixedwingSVG(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <path d="M12 2.2 L13.35 19 L12 21.6 L10.65 19 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.4"></path>
  <path d="M2.6 12.6 L10.9 10.7 L10.9 14.2 L2.6 16.1 Z" fill="${AMBER}"></path>
  <path d="M21.4 12.6 L13.1 10.7 L13.1 14.2 L21.4 16.1 Z" fill="${AMBER}"></path>
  <path d="M7.7 19.2 L11.3 18.6 L11.3 20.3 L7.7 20.4 Z" fill="${AMBER}"></path>
  <path d="M16.3 19.2 L12.7 18.6 L12.7 20.3 L16.3 20.4 Z" fill="${AMBER}"></path>
</svg>`
}

export function aircraftMarkerSVG(role: Aircraft['role'], size: number): string {
  return role === 'rotary' ? rotarySVG(size) : fixedwingSVG(size)
}

// ── Ground-report glyphs, {C} = status colour ───────────────────────────────

const RING = (extra = '') =>
  `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5" ${extra}></circle>`

// A patrol car in side view — far more legible than the earlier front-on slab,
// which read as a microbus. Washer/wheel gaps are cut in INK0.
const CAR = `
  <path d="M5.6 12.4 L7.1 9.6 c0.3 -0.5 0.7 -0.8 1.3 -0.8 h5.9 c0.6 0 1.1 0.3 1.4 0.8 l1.4 2.8 v2.9 c0 0.5 -0.3 0.8 -0.8 0.8 h-0.4 c-0.5 0 -0.8 -0.3 -0.8 -0.8 v-0.5 h-8.2 v0.5 c0 0.5 -0.3 0.8 -0.8 0.8 h-0.4 c-0.5 0 -0.8 -0.3 -0.8 -0.8 z" fill="{C}"></path>
  <path d="M8.1 9.7 h3.1 v2.1 h-4 z" fill="${INK0}" opacity="0.85"></path>
  <path d="M12 9.7 h2.3 l1.1 2.1 h-3.4 z" fill="${INK0}" opacity="0.85"></path>
  <circle cx="8.3" cy="15.6" r="1.25" fill="${INK0}"></circle>
  <circle cx="15.7" cy="15.6" r="1.25" fill="${INK0}"></circle>`

const REPORT_TEMPLATES: Record<Report['kind'], string> = {
  // marked: roof lightbar + door stripe — the two cues that say "police car"
  marked: RING() + CAR + `
  <rect x="9.6" y="7.5" width="4.8" height="1.2" rx="0.4" fill="{C}" stroke="${INK0}" stroke-width="0.3"></rect>
  <path d="M6.6 13.9 h10.8" stroke="${INK0}" stroke-width="0.75" opacity="0.75"></path>`,

  // unmarked: the same car with no lightbar and no livery, inside a dashed ring
  unmarked: RING('stroke-dasharray="2 1.6"') + CAR + `
  <circle cx="12" cy="12" r="10.9" stroke="{C}" stroke-width="0.5" opacity="0.5"></circle>`,

  // hidden: visibility-OFF. An open eye means "visible", which is backwards for
  // a unit that is hiding; the slash is what makes it read as concealed.
  hidden: RING() + `
  <path d="M4.9 12 C6.8 8.6 9.2 7.4 12 7.4 C14.8 7.4 17.2 8.6 19.1 12 C17.2 15.4 14.8 16.6 12 16.6 C9.2 16.6 6.8 15.4 4.9 12 Z" stroke="{C}" stroke-width="1.3" fill="none"></path>
  <circle cx="12" cy="12" r="1.9" fill="{C}"></circle>
  <path d="M6.4 18.2 L17.6 5.8" stroke="${INK0}" stroke-width="3.4" stroke-linecap="round"></path>
  <path d="M6.4 18.2 L17.6 5.8" stroke="{C}" stroke-width="1.6" stroke-linecap="round"></path>`,

  // stop: an octagon, because a warning triangle with "!" reads as generic
  // hazard, not "this car is being pulled over"
  stop: RING() + `
  <path d="M8.9 6.6 h6.2 l3.3 3.3 v6.2 l-3.3 3.3 h-6.2 l-3.3 -3.3 v-6.2 z" stroke="{C}" stroke-width="1.7" fill="none" stroke-linejoin="round"></path>
  <path d="M8.4 12 h7.2" stroke="{C}" stroke-width="1.7" stroke-linecap="round"></path>`,

  // checkpoint: a boom gate — post, base and a STRIPED horizontal arm
  checkpoint: RING() + `
  <rect x="5.9" y="8.6" width="1.7" height="8.4" rx="0.35" fill="{C}"></rect>
  <rect x="4.9" y="16.6" width="3.7" height="1.5" rx="0.3" fill="{C}"></rect>
  <path d="M7.6 9.9 h10.9 v2.1 h-10.9 z" fill="{C}"></path>
  <path d="M9.7 9.9 l1.4 2.1 M12.4 9.9 l1.4 2.1 M15.1 9.9 l1.4 2.1" stroke="${INK0}" stroke-width="0.75"></path>
  <circle cx="7.6" cy="10.95" r="0.95" fill="${INK0}"></circle>`,

  // rbt: a slashed glass ("no alcohol"). A breathalyser device was tried and
  // read as a walkie-talkie, and a bare tube as a straw — the prohibition symbol
  // is what actually communicates roadside alcohol testing at this size.
  rbt: RING() + `
  <path d="M9.1 6.2 h5.8 l-0.5 4.3 c-0.15 1.3 -1.0 2.1 -2.4 2.1 s-2.25 -0.8 -2.4 -2.1 z" fill="{C}"></path>
  <path d="M12 12.6 v3.5 M9.7 16.5 h4.6" stroke="{C}" stroke-width="1.3" stroke-linecap="round"></path>
  <path d="M6.3 18.3 L17.7 5.7" stroke="${INK0}" stroke-width="3.2" stroke-linecap="round"></path>
  <path d="M6.3 18.3 L17.7 5.7" stroke="{C}" stroke-width="1.6" stroke-linecap="round"></path>`,

  // camera: kept — it already read clearly as a speed camera. Proportions tidied.
  camera: RING() + `
  <rect x="6.2" y="9.4" width="10.4" height="6.6" rx="0.9" fill="{C}"></rect>
  <circle cx="11.2" cy="12.7" r="2.3" fill="${INK0}"></circle>
  <circle cx="11.2" cy="12.7" r="1.15" fill="{C}"></circle>
  <rect x="13.9" y="7.9" width="2.1" height="1.6" rx="0.25" fill="{C}"></rect>
  <rect x="11.4" y="16" width="1.4" height="2.6" fill="{C}"></rect>
  <path d="M9.4 18.6 h5.4" stroke="{C}" stroke-width="1.4" stroke-linecap="round"></path>`,
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
