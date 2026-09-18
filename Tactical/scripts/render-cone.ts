#!/usr/bin/env node
/**
 * Render the forward-visibility cone by altitude, for BOTH airframes.
 *
 * WHY THIS EXISTS: the cone only appears on the map for a LIVE aircraft, so on a day the
 * fleet is on the ground there is nothing on screen to review. This draws the same SVG the
 * map draws, at the same metres-per-pixel, so the shape can be checked — including the two
 * things that are easy to get wrong and invisible in a unit test: that a helicopter's cone
 * differs from a fixed wing's, and that the fade runs least-transparent at the aircraft.
 *
 *   node --experimental-strip-types scripts/render-cone.ts > /tmp/cone.html
 *   google-chrome-stable --headless --screenshot=/tmp/cone.png --window-size=1250,900 \
 *     --hide-scrollbars file:///tmp/cone.html
 */
import {
  visionConeForAltitude, visionConeSVG, metresPerPixel, coneCeilingM, VISION_PROFILES,
  type VisionRole,
} from '../lib/pilot-vision.ts'

// A realistic map view: the fleet's operating area, at zoom 12 (~15 m/px at this latitude).
const ZOOM = 12
const LAT = -37.8
const MPP = metresPerPixel(ZOOM, LAT)
const ALTITUDES_FT = [500, 1000, 2000, 4000, 8000, 12000, 20000, 28000]

const cell = (role: VisionRole, ft: number) => {
  const altM = ft * 0.3048
  const cone = visionConeForAltitude(altM, { role })
  if (!cone) {
    return `<div class="cell"><div class="box" style="width:220px;height:230px">
      <span class="none">no useful<br>forward view</span></div>
      <div class="cap">${ft.toLocaleString()} ft<br><span class="dim">band closed<br>(blind area &gt; acuity range)</span></div></div>`
  }
  const box = 220
  const svg = visionConeSVG(cone, MPP, { idSuffix: `${role}-${ft}` })
  return `<div class="cell">
    <div class="box" style="width:${box}px;height:230px">
      <svg width="${box}" height="230" overflow="visible" style="transform:translateY(85px)">
        <line x1="${box / 2}" y1="15" x2="${box / 2}" y2="95" stroke="#263746" stroke-width="1"></line>
        <g transform="translate(${box / 2},95)">
          <g class="cone">${svg.replace(/<\/?svg[^>]*>/g, '')}</g>
          <circle cx="0" cy="0" r="3" fill="#00d4ff"></circle>
        </g>
      </svg>
    </div>
    <div class="cap">${ft.toLocaleString()} ft &nbsp;·&nbsp; ${Math.round(altM)} m<br>
      <span class="dim">${Math.round(cone.nearM)}–${Math.round(cone.farM)} m
      (${Math.round(cone.farM - cone.nearM)} m)<br>${cone.limitedBy}</span></div>
  </div>`
}

const closest = (r: VisionRole) => Math.round(coneCeilingM({ role: r }))
const half = VISION_PROFILES.rotary.halfFovDeg !== VISION_PROFILES.fixedwing.halfFovDeg

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { background:#0A0B0D; color:#c9d1d9; font:12px/1.5 monospace; margin:0; padding:16px; }
  h1 { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:#8b949e; margin:18px 0 2px; }
  .note { color:#667582; font-size:11px; margin:0 0 10px; max-width:1080px; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-start; }
  .cell { text-align:center; }
  .box { background:#0e1218; border:1px solid #232a33; border-radius:6px; display:flex; align-items:flex-start; justify-content:center; overflow:hidden; }
  .cap { font-size:10px; color:#8b949e; margin-top:4px; }
  .dim { color:#5b6472; }
  .none { color:#667582; font-size:10px; align-self:center; }
  path { stroke: rgba(0,212,255,0.35); stroke-width:1; stroke-dasharray:3 4; }
  .rotary path { stroke: rgba(91,214,138,0.40); }
  .rotary .cone path { fill-opacity: 1; }
</style></head><body>

<h1>Helicopter (rotary) — hovering, steep look-down, wide scan</h1>
<p class="note">Profile: near depression ${VISION_PROFILES.rotary.nearDepressionDeg}°, far ${VISION_PROFILES.rotary.farDepressionDeg}°,
half-FOV ±${VISION_PROFILES.rotary.halfFovDeg}°. Usable band closes above ~${closest('rotary')} m.</p>
<div class="row rotary">${ALTITUDES_FT.map((ft) => cell('rotary', ft)).join('')}</div>

<h1>Fixed wing (King Air) — forward flight, shallower look-down, narrower scan</h1>
<p class="note">Profile: near depression ${VISION_PROFILES.fixedwing.nearDepressionDeg}°, far ${VISION_PROFILES.fixedwing.farDepressionDeg}°,
half-FOV ±${VISION_PROFILES.fixedwing.halfFovDeg}°. A bigger blind area behind the nose, so the band closes LOWER — above ~${closest('fixedwing')} m.
Same acuity physics in both rows; only the look-down geometry differs${half ? '' : ' (FOV assumed equal)'}.</p>
<div class="row">${ALTITUDES_FT.map((ft) => cell('fixedwing', ft)).join('')}</div>

<p class="note" style="margin-top:14px">Drawn at ${MPP.toFixed(1)} m/px (zoom ${ZOOM}, lat ${LAT}) from lib/pilot-vision.ts.
20/20 acuity = 1 arcminute; detection = 1 line pair (Johnson); clear air; 80 m minimum visible distance.
An ESTIMATE — a model, not a sensor spec. The fill is least transparent at the aircraft and fades to nothing at the far edge.</p>
</body></html>`

process.stdout.write(html)
