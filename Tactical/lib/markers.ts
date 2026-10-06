// Map glyph SVGs for VP-Overwatch markers.
//
// Aircraft silhouettes are aviation cyan and are drawn to read at 36 px on a
// dark map, which is the size that actually matters. Two different conventions,
// chosen because they were tested at that size rather than guessed:
//
//   rotary     TOP-VIEW helicopter with a spinning four-blade rotor, long tail
//              boom and an offset tail rotor. A top-down view was tried, then
//              abandoned for a profile view, then returned to once a real
//              reference was available: the earlier top-down attempt failed only
//              because it was drawn as a bare cross of blades (a crosshair at
//              36 px), not because top-down is wrong. The boom supplies the
//              asymmetry that fixes it. Rotates to heading; blades spin.
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
export const BLUE = '#1a6bff' // informational ground contact — cameras, concealed units
// A helicopter sighting is not a unit on a road and must not read as one: it is a
// thing in the AIR, placed by eye on a privileged broadcast. Violet, because it is
// the one kind that can appear with no transponder behind it.
export const HELI = '#b06bff'
export const INK0 = '#0A0B0D' // marker base fill

// Blades, prop discs and hub highlights: near-white, so they read over both the aircraft
// body and the dark map. Module-level because BOTH aircraft glyphs draw them — it used to
// live inside rotarySVG, which is exactly why the King Air glyph could not reference it.
const PALE = '#e6f9ff'

// ── Aircraft silhouettes ────────────────────────────────────────────────────

/**
 * Top-view helicopter, nose up: spun four-blade rotor, stout tail boom, offset
 * two-blade tail rotor.
 *
 * Modelled on a real top-down helicopter render (blunt cabin forward, long boom
 * aft, radial blade star over the hub). Every iteration was checked at 36 px —
 * the size it is actually drawn — and three plausible-looking ideas failed
 * there, which is the whole reason this comment exists:
 *
 *   - a translucent "motion-blur disc" instead of blades: a flat blob, and the
 *     blades are the actual signifier of a rotorcraft;
 *   - a circular rotor-disc ring around the blades: reads as a RETICLE (worst
 *     score of the set) and competes with the body;
 *   - thick solid blades rooted at the hub: the white mass swallows the cabin
 *     and the result reads as a shuriken/quadcopter.
 *
 * What works: SLENDER tapered blades, faint GHOST blade positions at +30 and
 * +60 degrees so any frozen frame shows rotation instead of a static cross, and
 * a boom stout enough to anchor the silhouette at small size. The two-blade tail
 * rotor replaces an earlier circle-with-a-cross, which read as a target node.
 *
 * Because the shape is top-down the marker still rotates to heading (map.tsx);
 * the spinning blade group inside it turns independently of that.
 */
function rotarySVG(size: number): string {
  const BODY2 = '#0086ab' // boom / sponsons: darker cyan for depth
  const BLADE = 'M11.5 1.6 l1.0 0 l0 4.2 l1.35 0 l0 11.4 l-1.35 0 l0 4.2 l-1.0 0 z'
  const bladeAt = (a: number, op: number) =>
    `<path transform="rotate(${a} 12 12)" d="${BLADE}" fill="${PALE}" opacity="${op}"></path>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <path d="M12 3.2 c2.25 0 3.45 1.7 3.65 3.5 l0.4 4.6 c0.05 0.95 -0.8 1.65 -1.75 1.75 l-4.6 0 c-0.95 -0.1 -1.8 -0.8 -1.75 -1.75 l0.4 -4.6 c0.2 -1.8 1.4 -3.5 3.65 -3.5 z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.45"></path>
  <path d="M12 3.9 c1.65 0 2.6 1.5 2.75 3.1 l0.1 1.4 l-5.7 0 l0.1 -1.4 c0.15 -1.6 1.1 -3.1 2.75 -3.1 z" fill="${INK0}" opacity="0.72"></path>
  <path d="M10.35 13.1 l3.3 0 l-0.35 7.5 l-2.6 0 z" fill="${BODY2}" stroke="${INK0}" stroke-width="0.32"></path>
  <path d="M8.3 11.2 l-2.8 0.7 l0 1.35 l2.8 0.45 z" fill="${BODY2}" opacity="0.95"></path>
  <path d="M15.7 11.2 l2.8 0.7 l0 1.35 l-2.8 0.45 z" fill="${BODY2}" opacity="0.95"></path>
  <circle cx="12" cy="21.5" r="0.55" fill="${PALE}"></circle>
  <path d="M12 19.6 l0 3.8 M10.1 21.5 l3.8 0" stroke="${PALE}" stroke-width="0.75" stroke-linecap="round" opacity="0.9"></path>
  ${bladeAt(30, 0.22)}${bladeAt(120, 0.22)}${bladeAt(210, 0.22)}${bladeAt(300, 0.22)}
  ${bladeAt(60, 0.13)}${bladeAt(150, 0.13)}${bladeAt(240, 0.13)}${bladeAt(330, 0.13)}
  <g class="vp-rotor">
    ${bladeAt(0, 1)}${bladeAt(90, 1)}${bladeAt(180, 1)}${bladeAt(270, 1)}
  </g>
  <circle cx="12" cy="12" r="2.1" fill="${INK0}" opacity="0.65"></circle>
  <circle cx="12" cy="12" r="1.45" fill="${PALE}"></circle>
</svg>`
}

/**
 * Fixed wing — drawn as the airframe that actually flies this role: a Beechcraft King Air
 * 350ER (VH-PVE), the fleet's only fixed-wing aircraft.
 *
 * The cues that make a twin turboprop read rather than a jet, in order of how much they
 * matter at 36px:
 *   STRAIGHT wings  — a King Air's wings are unswept; a swept leading edge reads as a jet
 *   two NACELLES    on the wings, each with a pale prop disc across its face (no jet pods)
 *   a T-TAIL        — the tailplane sits at the very aft end, past the fin
 * The previous glyph was a generic swept-wing jet with no engines at all.
 *
 * The nose is CUT OFF STRAIGHT, by the operator's instruction, rather than domed. That
 * needs enough fuselage ahead of the wing to read as a slice: the first attempt put the
 * face 2-3 px ahead of the leading edge at 36px and a review pass read it as a sprite
 * cropped by its bounding box, with the flat front and pointed tail making the direction
 * ambiguous. Hence the longer nose section (y 3 -> 10.5) and a slightly narrower face than
 * the body behind it, so the cut is visibly a cut.
 */
function fixedwingSVG(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <path d="M10.8 3 L13.2 3 L13.32 18.2 L12 22.4 L10.68 18.2 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.4"></path>
  <path d="M11 10.5 L2.6 11.3 L2.4 13.3 L11 13.7 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.3"></path>
  <path d="M13 10.5 L21.4 11.3 L21.6 13.3 L13 13.7 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.3"></path>
  <rect x="5.6" y="8.2" width="2.4" height="5.6" rx="0.6" fill="${AMBER}" stroke="${INK0}" stroke-width="0.3"></rect>
  <rect x="16" y="8.2" width="2.4" height="5.6" rx="0.6" fill="${AMBER}" stroke="${INK0}" stroke-width="0.3"></rect>
  <path d="M5.1 8.3 H8.5" stroke="${PALE}" stroke-width="0.85" stroke-linecap="round"></path>
  <path d="M15.5 8.3 H18.9" stroke="${PALE}" stroke-width="0.85" stroke-linecap="round"></path>
  <path d="M12 17.4 V21.6" stroke="${PALE}" stroke-width="0.45" opacity="0.85"></path>
  <path d="M7.9 19.2 L12 18.7 L16.1 19.2 L16.1 20.3 L12 20 L7.9 20.3 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.3"></path>
</svg>`
}

// ── Side-profile silhouettes: the Overwatch AIRCRAFT TRACKING view ───────────
//
// The two glyphs above are TOP-DOWN, and a top-down drawing cannot show a side-on
// view however the camera is aimed: with `pitchAlignment: 'viewport'` the glyph stays
// screen-facing, so it keeps reading as "seen from above" while the ground is read
// edge-on. That mismatch IS the "it still looks birdseye" complaint, and it is why
// these exist rather than a camera tweak alone.
//
// ORIENTATION, and how the camera arithmetic lands (keep this in step with SIDE_DEG in
// map.tsx):
//
//   - Each silhouette below is DESIGNED nose-LEFT (nose at low x, tail at high x — the natural
//     way to draw a side elevation), then wrapped in `rotate(90 12 12)` so the EXPORTED glyph is
//     nose-UP. Nose-up is what makes the tracking view come out straight, and the arithmetic in
//     the next point is why.
//   - In the tracking view the glyph's screen angle is (icon rotation − map bearing) = −SIDE_DEG.
//     The exported art adds its own orientation on top of that. With the art exported NOSE-UP the
//     two coincide exactly: the nose lands on −SIDE_DEG, which is precisely the direction of
//     travel, so a side-on aircraft faces the way it is going.
//
// This wrapper used to be `rotate(-90)`, exporting the glyph nose-DOWN, and that put the nose
// exactly 180° out — a helicopter travelling right with its nose pointing left, flying backwards
// along its own trail. That is the "the heli is sideways" report.
//
// Flipping SIDE_DEG does NOT fix it, which is the trap that cost a round trip: the error is in the
// ART, so reversing the camera reverses the travel and the nose together and the two stay 180°
// apart. Measured both ways — SIDE_DEG −90 gave "travelling right, nose left", +90 gave
// "travelling left, nose right", both backwards. The wrapping is what had to change.
//
// Judged at the size it is DRAWN, like all marker art here — a review sheet of this art
// at 36 px showed both glyphs collapsing into blobs, which is why the tracking view now
// draws them at 60 px (see AIRCRAFT_SIDE_SIZE in map.tsx). Preview: scripts/render-markers.ts.

/**
 * Side elevation of a rotary aircraft: edge-on main rotor over a blunt-nosed cabin,
 * a tapering tail boom with the fin and tail rotor aft, and a single skid rail below.
 *
 * What carries the read at 36 px, in order: the ROTOR BLADES SEEN EDGE-ON as one
 * shallow arc above the cabin (the unambiguous rotorcraft cue from the side), the
 * long tail boom, and the skid rail. Cabin glazing is a dark patch, not drawn panes —
 * panes vanish below ~44 px and turn the cabin into noise.
 */
function rotarySideSVG(size: number): string {
  const BODY2 = '#0086ab' // boom / fin: darker cyan for depth, as in rotarySVG
  // A side elevation of the AW139 that actually flies this role, drawn SEE-THROUGH: the fills sit
  // at 0.14-0.30 opacity and the strokes carry the silhouette, so the ground stays readable through
  // the aircraft. The previous cut was a rotor bar over a rounded blob with a stub boom, which read
  // as a generic shape rather than a helicopter — the identifying cues of a side view are the long
  // glass nose, the engine deck over the cabin, and the tail boom tapering into a finned tail rotor,
  // and none of those were there.
  //
  // Gear is deliberately absent: this is an in-flight view and the AW139's gear is retracted, so
  // drawing it would be inventing detail.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <g transform="rotate(90 12 12)">
    <path d="M2.5 5.05 L21.5 5.05" stroke="${PALE}" stroke-width="0.85" stroke-linecap="round" opacity="0.8"></path>
    <path d="M10.75 3.9 L11.35 3.9 L11.35 8.5 L10.75 8.5 Z" fill="${PALE}" opacity="0.75"></path>
    <path d="M9.7 4.75 L12.4 4.75 L12.4 5.45 L9.7 5.45 Z" fill="${PALE}" opacity="0.55"></path>
    <path d="M2.5 10.7 C3.3 9.0 5.2 8.25 7.3 8.15 L12.6 8.05 C14.0 8.0 15.1 8.55 15.7 9.4 L16.25 11.25 C16.65 12.7 15.6 13.6 14.0 13.7 L6.4 13.9 C4.0 14.0 2.75 12.7 2.5 10.7 Z"
      fill="${AMBER}" opacity="0.26" stroke="${AMBER}" stroke-width="0.5" stroke-linejoin="round"></path>
    <path d="M3.3 10.25 C4.0 9.2 5.4 8.7 6.9 8.6 L6.95 10.6 C5.6 10.7 4.2 10.7 3.3 10.25 Z"
      fill="${PALE}" opacity="0.3" stroke="${PALE}" stroke-width="0.32"></path>
    <path d="M8.6 8.1 C9.0 6.85 10.2 6.35 11.6 6.45 L13.4 6.65 C14.35 6.8 14.75 7.4 14.65 8.2 L14.55 8.75"
      fill="${PALE}" opacity="0.14" stroke="${PALE}" stroke-width="0.38" stroke-linecap="round"></path>
    <path d="M6.2 12.05 L14.2 11.9" stroke="${PALE}" stroke-width="0.3" opacity="0.35"></path>
    <path d="M15.5 9.65 L20.55 9.05 L20.8 10.35 L15.9 11.4 Z"
      fill="${BODY2}" opacity="0.28" stroke="${BODY2}" stroke-width="0.38" stroke-linejoin="round"></path>
    <path d="M19.55 10.0 L20.6 8.3 L21.9 6.9 L22.25 7.35 L22.25 9.5 L21.05 10.3 Z"
      fill="${BODY2}" opacity="0.28" stroke="${BODY2}" stroke-width="0.38" stroke-linejoin="round"></path>
    <path d="M22.05 5.95 L22.05 10.15" stroke="${PALE}" stroke-width="0.5" stroke-linecap="round" opacity="0.7"></path>
    <circle cx="22.05" cy="8.05" r="0.5" fill="${PALE}" opacity="0.85"></circle>
    <path d="M18.1 10.55 L20.6 10.35" stroke="${PALE}" stroke-width="0.42" stroke-linecap="round" opacity="0.6"></path>
  </g>
</svg>`
}

/**
 * Side elevation of the King Air 350ER — the airframe that actually flies this role.
 *
 * The side view's identification cues are NOT the top-down ones, and the first cut of
 * this glyph proved it: judged on the review sheet it read as a generic twin-engine
 * aircraft (or a jet), because the wing — edge-on and hidden behind the fuselage in a
 * true side view — was drawn as a band that crossed the body. What was carrying the
 * read was nothing.
 *
 * The cues that DO carry it from the side, in order: the NOSE CUT OFF STRAIGHT (the
 * operator's standing instruction — a domed side profile reads as a light aircraft),
 * a nacelle with a PALE PROP DISC and a blade across it (the only thing that says
 * turboprop rather than jet), and the fin with the tailplane at its very TOP (T-tail).
 * The wing fairing was dropped rather than redrawn: at this size the nacelle IS the
 * wing statement, and every extra mark costs legibility.
 */
function fixedwingSideSVG(size: number): string {
  const BODY2 = '#0086ab'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <g transform="rotate(90 12 12)">
    <path d="M2.2 10.8 L20.2 11.5 L23.2 12.2 L20.2 12.9 L2.2 14.4 Z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.42"></path>
    <path d="M3.2 11.15 l2.3 0.1 l0.2 1.9 l-2.5 -0.15 z" fill="${INK0}" opacity="0.7"></path>
    <path d="M7.0 12.2 h1.15 M8.9 12.25 h1.15 M10.8 12.3 h1.15 M12.7 12.35 h1.15" stroke="${INK0}" stroke-width="0.66" opacity="0.66"></path>
    <path d="M6.6 13.9 l4.1 0 c0.42 0 0.72 0.3 0.72 0.72 l0 1.15 c0 0.42 -0.3 0.72 -0.72 0.72 l-4.1 0 z" fill="${BODY2}" stroke="${INK0}" stroke-width="0.26"></path>
    <circle cx="6.3" cy="14.95" r="1.75" fill="${PALE}" opacity="0.46"></circle>
    <path d="M6.3 13.2 l0 3.5" stroke="${PALE}" stroke-width="0.48" stroke-linecap="round" opacity="0.92"></path>
    <path d="M11.6 13.35 l3.7 0 c0.38 0 0.64 0.26 0.64 0.64 l0 1.0 c0 0.38 -0.26 0.64 -0.64 0.64 l-3.7 0 z" fill="${BODY2}" stroke="${INK0}" stroke-width="0.24"></path>
    <circle cx="11.35" cy="14.3" r="1.42" fill="${PALE}" opacity="0.36"></circle>
    <path d="M11.35 12.9 l0 2.8" stroke="${PALE}" stroke-width="0.42" stroke-linecap="round" opacity="0.85"></path>
    <path d="M19.4 11.6 l0 -5.2 l1.5 0 l0 5.1 z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.28"></path>
    <path d="M18.2 5.8 l4.4 0 l0 0.9 l-4.4 0 z" fill="${AMBER}" stroke="${INK0}" stroke-width="0.28"></path>
    <path d="M9.6 16.5 l0 1.2 M14.0 15.9 l0 1.5" stroke="${PALE}" stroke-width="0.55" opacity="0.78"></path>
  </g>
</svg>`
}

/**
 * Which view an aircraft glyph is drawn for.
 *  - `top`  — the map's normal north-up view. Top-down silhouettes.
 *  - `side` — the Overwatch tracking view, where the camera sits abeam and the
 *             aircraft must read as a side elevation (see the notes above).
 */
export type AircraftView = 'top' | 'side'

export function aircraftMarkerSVG(
  role: Aircraft['role'],
  size: number,
  view: AircraftView = 'top'
): string {
  if (view === 'side') return role === 'rotary' ? rotarySideSVG(size) : fixedwingSideSVG(size)
  return role === 'rotary' ? rotarySVG(size) : fixedwingSVG(size)
}

// ── Which ground kinds blink ────────────────────────────────────────────────
/**
 * Ground kinds that carry the blue/red police overglow (see `.vp-police` in
 * globals.css). Kept here, next to the glyphs, so the answer to "what blinks?"
 * lives with the artwork rather than being buried in the map component.
 *
 * The glow is not decoration: the badge artwork cannot read at 30px, so the
 * blinking light is what identifies the unit at that size.
 */
export const GLOWING_KINDS: Report['kind'][] = ['marked', 'unmarked']

export function isGlowingKind(kind: Report['kind']): boolean {
  return GLOWING_KINDS.includes(kind)
}

// ── Ground-report glyphs, {C} = status colour ───────────────────────────────

const RING = (extra = '') =>
  `<circle cx="12" cy="12" r="10" fill="${INK0}" stroke="{C}" stroke-width="1.5" ${extra}></circle>`

// The drawn patrol-car glyph that used to back `marked` is gone: the operator's own
// car artwork now fills both car kinds. It was removed as dead code in the same change
// that introduced the art, so no fallback is hiding here — if an art file goes missing
// the glyph simply does not draw. Recoverable from the previous commit if ever wanted
// back as a vector fallback.

// Operator-supplied raster/vector art for the vehicle-ish kinds. The two caps come
// from the stock sheet he sent (blue hat + black hat), cropped, traced to SVG by
// /tmp/vectorise_hats.py and assigned as he directed:
//
//   marked-hat.svg    -> marked    the BLUE cap, as supplied
//   unmarked-hat.svg  -> unmarked  the black cap LIFTED TO STEEL GREY, because at 30px
//                                  the black version collapses into the dark map
//                                  background (measured: a dark blob with a gold dot)
//   camera-badge.png  -> camera    the speed camera from his 3-logo sheet (still raster;
//                                  vectorising it too is a one-command follow-up)
//
// Vector, not raster: at 30px a raster marker blurs, an SVG stays crisp at every size.
// Served as FILES (one request each, browser-cached) rather than base64-inlined per
// marker: ~24 render at once and this box runs on 7.4GB of RAM.
//
// NOTE these kinds no longer take the `{C}` status tint — the art carries its own
// palette, and identity is carried by the blue/red blink instead (see GLOWING_KINDS).
const ART = (href: string) =>
  `<image href="${href}" x="0.5" y="0.5" width="23" height="23" preserveAspectRatio="xMidYMid meet"></image>`

const REPORT_TEMPLATES: Record<Report['kind'], string> = {
  // marked: the operator's blue police cap.
  marked: ART('/markers/marked-hat.svg'),

  // unmarked: the grey police cap. The two car badges from the earlier 3-logo sheet
  // (marked-police-car.png, unmarked-car.png) are kept in public/markers but are now
  // unused by any kind, as is the officer badge (unmarked-badge.png).
  unmarked: ART('/markers/unmarked-hat.svg'),

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

  // camera: the sheet's speed-camera badge, replacing the drawn glyph.
  //
  // FLAG: this badge's shield is AMBER, and amber is semantic in this app (warnings,
  // MLAT, fuel-overrun). A speed camera is not a warning state, so amber vehicle art
  // risks reading as one. Recolouring just the shield border to the app blue is a
  // one-line change to the asset if that bothers him.
  // camera: the speed camera cropped from the operator's 3-logo sheet, now traced to
  // SVG with the same pipeline as the caps so all three markers are vector.
  camera: ART('/markers/camera-badge.svg'),

  // helicopter: a top-view rotorcraft — rotor disc, body, tail boom, tail rotor.
  //
  // Drawn rather than art because there is no source art for it, and drawn TOP-DOWN
  // because the ground-report family is all flat icons; a profile view would read as a
  // different class of object among them. The rotor disc is deliberately a thin ring
  // rather than a filled disc: filled, it swallows the body at 30 px and the whole
  // marker becomes a dot. Same lesson as the aircraft glyph in this file.
  helicopter: RING() + `
  <circle cx="11.4" cy="10.2" r="5.6" stroke="{C}" stroke-width="0.95" fill="none" opacity="0.8"></circle>
  <path d="M11.4 4.6 L21.2 10.2 M11.4 15.8 L4.2 10.2" stroke="{C}" stroke-width="0.95" opacity="0.55"></path>
  <path d="M9.9 8.1 c1.5 0 2.2 1 2.2 2.2 l0 1.9 c0 0.85 -0.65 1.5 -1.5 1.5 l-1.4 0 c-0.85 0 -1.5 -0.65 -1.5 -1.5 l0 -1.9 c0 -1.2 0.7 -2.2 2.2 -2.2 z" fill="{C}" stroke="${INK0}" stroke-width="0.35"></path>
  <path d="M12.1 10.9 l5.6 0 l-0.35 1.15 l-5.25 0 z" fill="{C}" stroke="${INK0}" stroke-width="0.3"></path>
  <circle cx="18.4" cy="11.47" r="1.5" fill="none" stroke="${INK0}" stroke-width="1.0"></circle>
  <circle cx="18.4" cy="11.47" r="1.5" fill="none" stroke="{C}" stroke-width="0.55"></circle>`,
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

// ── Overwatch ghost models ──────────────────────────────────────────────────
/**
 * The Overwatch view stands a HOLLOW model on a ground unit's reported position
 * and orbits it, rather than showing the flat badge the map uses. Two models
 * exist because the two ground threats are physically different objects: the
 * unit is a car, the camera is a fixed cabinet on a post.
 *
 * Art is reused from `public/markers/` rather than drawn fresh — the police car
 * is the operator's own artwork, which no badge kind has used since the cap
 * glyphs took over `marked`/`unmarked`. The camera is taken as VECTOR
 * (`camera-badge.svg`) even though its badge kind still uses the PNG: the ghost
 * renders at 96px, where the raster softens and the vector stays crisp.
 */
export type GhostModel = 'police' | 'camera' | 'helicopter'

/**
 * External art, for the models that HAVE art.
 *
 * `helicopter` is deliberately absent: its ghost is drawn inline (see ghostBody)
 * because the only rotary art in the repo is the aircraft marker, which is painted
 * aviation amber — reserved for ACTIVE AIRCRAFT. A helicopter SIGHTING is a ground
 * report, so amber would be both off-palette and misleading. Inline paths take the
 * ghost's own status colour instead, so the model matches the frame around it.
 */
export const GHOST_MODEL_ART: Record<'police' | 'camera', string> = {
  police: '/markers/marked-police-car.png',
  camera: '/markers/camera-badge.svg',
}

/**
 * Which ghost a ground kind gets in Overwatch.
 *
 * `marked` and `unmarked` are both a police CAR seen on the road, so both get the
 * car; `rbt` (a random breath-test station) is a police presence on the road and
 * takes the car too. `camera` is a fixed cabinet on a post. `helicopter` is a
 * crowdsourced SIGHTING rather than a unit position, but it is a ground contact the
 * operator can orbit, and orbiting an empty frame was reported as a defect — so it
 * gets a model of its own.
 *
 * `stop`, `checkpoint` and `hidden` still return null: they are road events, not
 * objects, and Overwatch shows no model rather than standing the wrong one on the
 * mark.
 */
export function ghostModelFor(kind: Report['kind']): GhostModel | null {
  if (kind === 'marked' || kind === 'unmarked' || kind === 'rbt') return 'police'
  if (kind === 'camera') return 'camera'
  if (kind === 'helicopter') return 'helicopter'
  return null
}

/**
 * The model itself: the operator's art where it exists, an inline glyph otherwise.
 * Both are drawn inside the same 30x30 box the <image> models occupy, so every ghost
 * stands at the same scale on its mark.
 */
function ghostBody(model: GhostModel, color: string): string {
  if (model === 'helicopter') {
    // Inline so the model takes the ghost's status colour — see GHOST_MODEL_ART.
    return `<g class="vp-ghost-model" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <ellipse cx="24" cy="15" rx="12.5" ry="1.6" opacity="0.7"></ellipse>
    <path d="M24 15.6 v5.2"></path>
    <path d="M19 26.4 c0 -3.2 2.3 -5.2 5 -5.2 s5 2 5 5.2 v3.4 c0 1.6 -1.3 2.9 -2.9 2.9 h-4.2 c-1.6 0 -2.9 -1.3 -2.9 -2.9 z"></path>
    <path d="M29 25.6 h5.4"></path>
    <path d="M19 25 l-7.6 -2.2"></path>
    <circle cx="10.4" cy="22.3" r="1.7"></circle>
    <path d="M20.5 32.7 v2.6 M27.5 32.7 v2.6"></path>
    <path d="M17 35.3 h14"></path>
  </g>`
  }
  return `<image class="vp-ghost-model" href="${GHOST_MODEL_ART[model]}" x="9" y="8" width="30" height="30" preserveAspectRatio="xMidYMid meet"></image>`
}

/**
 * A hollow "ghost" of a ground unit: a targeting frame and a slowly orbiting
 * ring drawn around the model, with the model itself left translucent so the
 * ground reads through it.
 *
 * The hollowness is deliberate and is what separates this from the badge: the
 * badge asserts "this is here now", the ghost is a viewing frame around a
 * reported position. It carries no fill of its own — the frame and ring are
 * STROKES only, and the model is blended so its dark pixels drop out against
 * the map.
 *
 * @param model Which object to stand on the mark.
 * @param color Status colour — threat red for a unit or a sighting, informational
 *   blue for a camera, matching the badge convention in the map.
 * @param size Rendered pixel size of the square frame.
 */
export function ghostMarkerSVG(
  model: GhostModel,
  color: string,
  size: number
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none">
  <g class="vp-ghost-spin">
    <circle cx="24" cy="24" r="21" stroke="${color}" stroke-width="0.6" stroke-dasharray="1.6 3.4" opacity="0.55"></circle>
  </g>
  <g stroke="${color}" stroke-width="1.1" stroke-linecap="round" opacity="0.85">
    <path d="M5 13 V5 H13"></path>
    <path d="M35 5 H43 V13"></path>
    <path d="M43 35 V43 H35"></path>
    <path d="M13 43 H5 V35"></path>
  </g>
  <ellipse cx="24" cy="41.5" rx="9" ry="2.1" stroke="${color}" stroke-width="0.7" opacity="0.45"></ellipse>
  ${ghostBody(model, color)}
</svg>`
}
