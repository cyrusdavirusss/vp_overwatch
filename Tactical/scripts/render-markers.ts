/**
 * Render every map marker to an HTML review sheet — the art is only ever judged
 * at the size it is drawn, so this shows aircraft icons at their live 36 px as
 * well as enlarged, and the ground glyphs at their real 30 px.
 *
 *   node --experimental-strip-types scripts/render-markers.ts > /tmp/markers.html
 *   google-chrome-stable --headless --screenshot=/tmp/markers.png \
 *     --window-size=1250,760 --hide-scrollbars file:///tmp/markers.html
 *
 * Kept in the repo because reviewing marker art by eye at 36 px is the only way
 * that has ever caught a bad icon here (a "rotor disc" that read as a blob, a
 * disc ring that read as a reticle, chunky blades that read as a shuriken).
 */
import { aircraftMarkerSVG, reportMarkerSVG, RED, BLUE } from '../lib/markers.ts'
import type { Report } from '../lib/data.ts'

const kinds: Report['kind'][] = ['marked', 'unmarked', 'hidden', 'stop', 'checkpoint', 'rbt', 'camera']
const colour: Record<string, string> = {
  marked: RED, unmarked: BLUE, hidden: BLUE, stop: RED, checkpoint: BLUE, rbt: BLUE, camera: BLUE,
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { background:#0A0B0D; color:#c9d1d9; font:13px/1.4 monospace; margin:0; padding:16px; }
  h2 { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#8b949e; margin:16px 0 6px; }
  .row { display:flex; gap:18px; align-items:flex-end; flex-wrap:wrap; }
  .cell { text-align:center; }
  .big { background:#0e1218; border:1px solid #232a33; border-radius:8px; padding:6px; margin-bottom:5px; display:inline-block; }
  .cap { font-size:9px; color:#6e7681; }
  .vp-rotor { transform-box: fill-box; transform-origin: center; animation: vp-rotor-spin .38s linear infinite; }
  @keyframes vp-rotor-spin { to { transform: rotate(360deg); } }
  .hdg { transform: rotate(35deg); }
</style></head><body>
<h2>Aircraft — live 36px first (the size that matters)</h2>
<div class="row">
  <div class="cell"><div class="big">${aircraftMarkerSVG('rotary', 36)}</div><div class="cap">helicopter 36px live</div></div>
  <div class="cell"><div class="big"><div class="hdg">${aircraftMarkerSVG('rotary', 36)}</div></div><div class="cap">helicopter 36px, heading 35 deg</div></div>
  <div class="cell"><div class="big">${aircraftMarkerSVG('rotary', 60)}</div><div class="cap">helicopter 60px</div></div>
  <div class="cell"><div class="big">${aircraftMarkerSVG('rotary', 140)}</div><div class="cap">helicopter 140px</div></div>
  <div class="cell"><div class="big">${aircraftMarkerSVG('fixedwing', 36)}</div><div class="cap">fixed wing 36px</div></div>
  <div class="cell"><div class="big">${aircraftMarkerSVG('fixedwing', 140)}</div><div class="cap">fixed wing 140px</div></div>
</div>
<h2>Ground glyphs — real 30px (as drawn on the map)</h2>
<div class="row">
${kinds.map((k) => `  <div class="cell"><div class="big" style="padding:10px">${reportMarkerSVG(k, colour[k], 30)}</div><div class="cap">${k}</div></div>`).join('\n')}
</div>
<h2>Ground glyphs enlarged</h2>
<div class="row">
${kinds.map((k) => `  <div class="cell"><div class="big">${reportMarkerSVG(k, colour[k], 100)}</div><div class="cap">${k}</div></div>`).join('\n')}
</div>
</body></html>`

console.log(html)
