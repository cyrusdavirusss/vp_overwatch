// Sandbox test for lib/ar-orientation.ts — asserts the camera-pointing and
// projection math against hand-verified physical cases. Compile with tsc + run
// with node; exits non-zero on any failure.

import {
  cameraBasis,
  azElOf,
  dirFromAzEl,
  projectDir,
  smoothBasis,
  panBasis,
  norm,
  type Vec3,
} from '../lib/ar-orientation'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  — ' + detail : ''}`)
}
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol
// compare azimuth allowing 0/360 wrap
const nearAz = (a: number, b: number, tol = 1) => {
  const d = Math.abs(((a - b + 540) % 360) - 180)
  return d <= tol
}

const HFOV = 60, VFOV = 100

console.log('═══ AR ORIENTATION SANDBOX TEST ═══\n')

// 1. Phone upright (beta=90), alpha=0 → rear camera points NORTH at the horizon.
{
  const b = cameraBasis(0, 90, 0, 0)
  const { azimuth, elevation } = azElOf(b.fwd)
  check('upright+alpha0 → camera North', nearAz(azimuth, 0), `az=${azimuth.toFixed(1)}`)
  check('upright → horizon (elev 0)', near(elevation, 0), `el=${elevation.toFixed(1)}`)
}

// 2. Tilt the top back to look up (beta=135) → 45° elevation, still North.
{
  const b = cameraBasis(0, 135, 0, 0)
  const { azimuth, elevation } = azElOf(b.fwd)
  check('tilt up beta135 → elevation ~45', near(elevation, 45, 2), `el=${elevation.toFixed(1)}`)
  check('tilt up → still North', nearAz(azimuth, 0, 2), `az=${azimuth.toFixed(1)}`)
}

// 3. Heading responds to alpha (turn the phone): alpha 90 changes azimuth by 90.
{
  const a0 = azElOf(cameraBasis(0, 90, 0, 0).fwd).azimuth
  const a90 = azElOf(cameraBasis(90, 90, 0, 0).fwd).azimuth
  const delta = Math.abs(((a90 - a0 + 540) % 360) - 180)
  check('alpha 0→90 swings azimuth ~90°', near(delta, 90, 2), `Δ=${delta.toFixed(1)}`)
}

// 4. A target straight along the camera axis projects to screen centre.
{
  const basis = cameraBasis(20, 110, 0, 0)
  const p = projectDir(basis.fwd, basis, HFOV, VFOV)
  check('on-axis target → centre', near(p.xPct, 50, 0.5) && near(p.yPct, 50, 0.5) && p.onScreen,
    `x=${p.xPct.toFixed(1)} y=${p.yPct.toFixed(1)}`)
}

// 5. A target at +HFOV/2 to camera-right projects to the right screen edge.
{
  const basis = cameraBasis(0, 90, 0, 0)
  const half = (HFOV / 2) * (Math.PI / 180)
  const d = norm([
    basis.fwd[0] * Math.cos(half) + basis.right[0] * Math.sin(half),
    basis.fwd[1] * Math.cos(half) + basis.right[1] * Math.sin(half),
    basis.fwd[2] * Math.cos(half) + basis.right[2] * Math.sin(half),
  ] as Vec3)
  const p = projectDir(d, basis, HFOV, VFOV)
  check('target at +HFOV/2 → right edge (x~100)', near(p.xPct, 100, 1) && p.onScreen, `x=${p.xPct.toFixed(1)}`)
}

// 6. Roll invariance: rolling the phone (gamma) keeps an on-axis target centred.
{
  const basis = cameraBasis(0, 90, 35, 0) // 35° roll
  const p = projectDir(basis.fwd, basis, HFOV, VFOV)
  check('roll 35° → on-axis still centred', near(p.xPct, 50, 0.5) && near(p.yPct, 50, 0.5),
    `x=${p.xPct.toFixed(1)} y=${p.yPct.toFixed(1)}`)
}

// 7. A target behind the camera is off-screen (negative depth).
{
  const basis = cameraBasis(0, 90, 0, 0)
  const behind: Vec3 = [-basis.fwd[0], -basis.fwd[1], -basis.fwd[2]]
  const p = projectDir(behind, basis, HFOV, VFOV)
  check('target behind → off-screen', !p.onScreen && p.depth < 0, `depth=${p.depth.toFixed(2)}`)
}

// 8. Calibration offset shifts azimuth by the given amount.
{
  const a = azElOf(cameraBasis(0, 90, 0, 0, 0).fwd).azimuth
  const aCal = azElOf(cameraBasis(0, 90, 0, 0, 15).fwd).azimuth
  const delta = ((aCal - a + 540) % 360) - 180
  check('calibration +15° shifts azimuth +15°', near(delta, 15, 1), `Δ=${delta.toFixed(1)}`)
}

// 9. Smoothing reduces step size and stays normalised.
{
  const A = cameraBasis(0, 90, 0, 0)
  const B = cameraBasis(40, 90, 0, 0)
  const s = smoothBasis(A, B, 0.2)
  const azA = azElOf(A.fwd).azimuth, azB = azElOf(B.fwd).azimuth, azS = azElOf(s.fwd).azimuth
  const fullStep = Math.abs(((azB - azA + 540) % 360) - 180)
  const smStep = Math.abs(((azS - azA + 540) % 360) - 180)
  const mag = Math.hypot(s.fwd[0], s.fwd[1], s.fwd[2])
  check('smoothed step < full step', smStep < fullStep, `${smStep.toFixed(1)} < ${fullStep.toFixed(1)}`)
  check('smoothed fwd stays unit length', near(mag, 1, 0.001), `|fwd|=${mag.toFixed(4)}`)
}

// 10. panBasis with no offset is a no-op.
{
  const b = cameraBasis(0, 90, 0, 0)
  const p = panBasis(b, 0, 0)
  check('panBasis(0,0) → unchanged', p.fwd === b.fwd, 'returns same basis ref')
}

// 11. Drag yaw rotates the look azimuth by the offset (about world up).
{
  const b = cameraBasis(0, 90, 0, 0) // North, horizon
  const az0 = azElOf(b.fwd).azimuth
  const azY = azElOf(panBasis(b, 90, 0).fwd).azimuth
  const delta = Math.abs(((azY - az0 + 540) % 360) - 180)
  check('drag yaw 90° swings azimuth ~90°', near(delta, 90, 1), `Δ=${delta.toFixed(1)}`)
}

// 12. Drag pitch raises elevation by the offset (about camera right).
{
  const b = cameraBasis(0, 90, 0, 0) // horizon
  const el = azElOf(panBasis(b, 0, 45).fwd).elevation
  check('drag pitch +45° → elevation ~45', near(el, 45, 1), `el=${el.toFixed(1)}`)
}

// 13. Pitch about camera-right stays correct under roll (target on new axis centres).
{
  const b = cameraBasis(0, 90, 30, 0) // 30° roll
  const panned = panBasis(b, 25, -15)
  const p = projectDir(panned.fwd, panned, HFOV, VFOV)
  check('panned basis: its own fwd projects to centre', near(p.xPct, 50, 0.5) && near(p.yPct, 50, 0.5),
    `x=${p.xPct.toFixed(1)} y=${p.yPct.toFixed(1)}`)
}

console.log(`\n═══ ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ═══`)
process.exit(failures === 0 ? 0 : 1)
