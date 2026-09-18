#!/usr/bin/env node
/**
 * Render the forward-visibility cone at a range of altitudes, as an HTML sheet.
 *
 * WHY THIS EXISTS: the cone only appears on the map for a LIVE aircraft, so on a day the
 * fleet is on the ground there is nothing on screen to look at and nothing to check. This
 * draws the same paths the map draws, at the same metres-per-pixel, so the shape can be
 * reviewed — and so the counter-intuitive part is visible: the cone WIDENS with altitude,
 * then narrows, then disappears.
 *
 *   node --experimental-strip-types scripts/render-cone.ts > /tmp/cone.html
 *   google-chrome-stable --headless --screenshot=/tmp/cone.png --window-size=1200,760 \
 *     --hide-scrollbars file:///tmp/cone.html
 */
import { visionConeForAltitude, visionConePathPx, metresPerPixel, coneCeilingM } from '../lib/pilot-vision.ts'

// A realistic map view: the fleet's operating area, at zoom 12 (~30 m/px at this latitude).
const ZOOM = 12
const LAT = -37.8
const MPP = metresPerPixel(ZOOM, LAT)

const ALTITUDES_FT = [500, 1000, 2000, 3000, 5000, 8000, 12000, 20000]

const cell = (ft: number) => {
  const altM = ft * 0.3048
  const cone = visionConeForAltitude(altM)
  if (!cone) {
    return `<div class="cell"><div class="box"><span class="none">no useful forward view</span></div>
      <div class="cap">${ft.toLocaleString()} ft<br><span class="dim">blind area has closed over the usable range</span></div></div>`
  }
  const path = visionConePathPx(cone, MPP)
  // Centre the origin in the box so the shape has room to extend ahead (upward).
  const box = 300
  const ox = box / 2
  const oy = box - 30
  const reach = Math.round(cone.farM / MPP)
  return `<div class="cell">
    <div class="box" style="width:${box}px;height:${box}px">
      <svg width="${box}" height="${box}">
        <g transform="translate(${ox},${oy})">
          <line x1="0" y1="0" x2="0" y2="-${oy - 6}" stroke="#263746" stroke-width="1"/>
          <path d="${path}"></path>
          <circle cx="0" cy="0" r="3" fill="#00d4ff"></circle>
        </g>
      </svg>
    </div>
    <div class="cap">${ft.toLocaleString()} ft &nbsp;·&nbsp; ${Math.round(altM)} m<br>
      <span class="dim">${Math.round(cone.nearM)} m – ${Math.round(cone.farM)} m &nbsp;(${Math.round(cone.farM - cone.nearM)} m band)<br>
      limited by ${cone.limitedBy} &nbsp;·&nbsp; ${reach}px at zoom ${ZOOM}</span></div>
  </div>`
}

const ceiling = Math.round(coneCeilingM())
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { background:#0A0B0D; color:#c9d1d9; font:12px/1.5 monospace; margin:0; padding:16px; }
  h1 { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:#8b949e; margin:0 0 4px; }
  .note { color:#667582; font-size:11px; margin:0 0 16px; max-width:900px; }
  .row { display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; }
  .cell { text-align:center; }
  .box { background:#0e1218; border:1px solid #232a33; border-radius:6px; display:flex; align-items:center; justify-content:center; }
  .cap { font-size:10px; color:#8b949e; margin-top:6px; }
  .dim { color:#5b6472; }
  .none { color:#667582; font-size:11px; }
  path { fill: rgba(0,212,255,0.08); stroke: rgba(0,212,255,0.45); stroke-width:1; stroke-dasharray:3 4; }
</style></head><body>
<h1>Forward-visibility cone by altitude</h1>
<p class="note">Drawn from lib/pilot-vision.ts at ${MPP.toFixed(1)} m/px (zoom ${ZOOM}, lat ${LAT}).
20/20 acuity = 1 arcmin; detection = 1 line pair (Johnson); clear air. An ESTIMATE, not a sensor spec.
The band widens with altitude while geometry limits the far edge, then narrows as the blind area beneath
the aircraft eats into the acuity-limited range — and above about ${ceiling} m there is no usable band at all.</p>
<div class="row">${ALTITUDES_FT.map(cell).join('')}</div>
</body></html>`

process.stdout.write(html)
