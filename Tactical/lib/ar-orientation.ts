// ─────────────────────────────────────────────────────────────────────────
// AR orientation math for the camera sky-overlay.
//
// The naive approach (use deviceorientation `alpha` as compass heading and
// `beta` as pitch) only holds when the phone is perfectly upright and unrolled —
// the moment you tilt up at the sky or roll the phone, headings swing wildly and
// reticles jump. This module instead builds the full device→world rotation and
// derives the camera's actual pointing vector and screen basis, so a target's
// screen position is correct at any tilt/roll. Pure + unit-testable.
//
// World frame: East-North-Up (ENU). x=east, y=north, z=up.
// Angles in degrees. Device frame at rest (flat, screen up): x=right, y=top,
// z=out of screen.
// ─────────────────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number]
export interface CamBasis {
  fwd: Vec3 // where the rear camera points (world ENU)
  right: Vec3 // screen-right direction (world ENU)
  up: Vec3 // screen-up direction (world ENU)
}

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const norm = (a: Vec3): Vec3 => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / m, a[1] / m, a[2] / m]
}
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

// Apply the W3C device→world rotation (intrinsic Z-X'-Y'') to a device vector.
function applyR(alpha: number, beta: number, gamma: number, v: Vec3): Vec3 {
  const a = alpha * D2R
  const b = beta * D2R
  const g = gamma * D2R
  const cA = Math.cos(a), sA = Math.sin(a)
  const cB = Math.cos(b), sB = Math.sin(b)
  const cG = Math.cos(g), sG = Math.sin(g)
  const m11 = cA * cG - sA * sB * sG
  const m12 = -cB * sA
  const m13 = cG * sA * sB + cA * sG
  const m21 = cA * sB * sG + cG * sA
  const m22 = cA * cB
  const m23 = sA * sG - cA * cG * sB
  const m31 = -cB * sG
  const m32 = sB
  const m33 = cB * cG
  return [
    m11 * v[0] + m12 * v[1] + m13 * v[2],
    m21 * v[0] + m22 * v[1] + m23 * v[2],
    m31 * v[0] + m32 * v[1] + m33 * v[2],
  ]
}

// Rotate a world vector about the up (Z) axis — used to apply a heading
// calibration offset (e.g. magnetic→true declination).
function rotateUp(v: Vec3, deg: number): Vec3 {
  const r = deg * D2R
  const c = Math.cos(r), s = Math.sin(r)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]
}

// Camera basis in world ENU from device orientation + screen rotation.
//   screenAngle: window screen orientation (0/90/180/270)
//   calibDeg:    heading calibration added about the vertical (declination/trim)
export function cameraBasis(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle = 0,
  calibDeg = 0,
): CamBasis {
  // Screen image axes in the device frame, rotated by the OS display angle.
  const sr = screenAngle * D2R
  const cs = Math.cos(sr), ss = Math.sin(sr)
  const rightDev: Vec3 = [cs, ss, 0]
  const upDev: Vec3 = [-ss, cs, 0]
  let fwd = applyR(alpha, beta, gamma, [0, 0, -1]) // rear camera looks along −Z
  let right = applyR(alpha, beta, gamma, rightDev)
  let up = applyR(alpha, beta, gamma, upDev)
  if (calibDeg) {
    // Negative: a +calibDeg trim should ADD to the reported compass azimuth
    // (azimuth = atan2(E,N) decreases as the vector rotates CCW about up).
    fwd = rotateUp(fwd, -calibDeg)
    right = rotateUp(right, -calibDeg)
    up = rotateUp(up, -calibDeg)
  }
  return { fwd: norm(fwd), right: norm(right), up: norm(up) }
}

// Compass azimuth (0=N,90=E) and elevation (deg above horizon) of a vector.
export function azElOf(v: Vec3): { azimuth: number; elevation: number } {
  const az = (Math.atan2(v[0], v[1]) * R2D + 360) % 360
  const el = Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D
  return { azimuth: az, elevation: el }
}

// Unit world vector for a target at compass bearing + elevation.
export function dirFromAzEl(bearingDeg: number, elevationDeg: number): Vec3 {
  const b = bearingDeg * D2R
  const e = elevationDeg * D2R
  const ce = Math.cos(e)
  return [ce * Math.sin(b), ce * Math.cos(b), Math.sin(e)]
}

export interface Projection {
  xPct: number
  yPct: number
  onScreen: boolean
  depth: number
}

// Project a world direction onto the screen given the camera basis + FOV.
export function projectDir(d: Vec3, basis: CamBasis, hfovDeg: number, vfovDeg: number): Projection {
  const depth = dot(d, basis.fwd)
  const axDeg = Math.atan2(dot(d, basis.right), depth) * R2D
  const ayDeg = Math.atan2(dot(d, basis.up), depth) * R2D
  const xPct = 50 + (axDeg / (hfovDeg / 2)) * 50
  const yPct = 50 - (ayDeg / (vfovDeg / 2)) * 50
  const onScreen = depth > 0 && Math.abs(axDeg) <= hfovDeg / 2 && Math.abs(ayDeg) <= vfovDeg / 2
  return { xPct, yPct, onScreen, depth }
}

// Exponentially smooth one basis toward another (per-frame), re-normalising.
// t in [0,1]; lower = smoother/heavier lag, higher = snappier.
export function smoothBasis(prev: CamBasis, next: CamBasis, t: number): CamBasis {
  return {
    fwd: norm(lerp3(prev.fwd, next.fwd, t)),
    right: norm(lerp3(prev.right, next.right, t)),
    up: norm(lerp3(prev.up, next.up, t)),
  }
}
