/**
 * Forward-visibility cone — the ground a crew can actually make something out on, ahead
 * of the aircraft.
 *
 * ── RESEARCHED, NOT INVENTED ───────────────────────────────────────────────────────
 * Three published relationships set the shape. None of them is a guess about this fleet:
 *
 * 1. ANGULAR RESOLUTION. 20/20 vision resolves features 1 arcminute apart — the Snellen
 *    standard, where a letter subtends 5 arcmin and its critical feature 1 arcmin
 *    (NIST, "Standards for Visual Acuity"; NIH StatPearls, "Evaluation of Visual Acuity").
 *    That is 0.000291 rad, or 60 resolvable elements per degree. Everything an observer
 *    can make out at range R must be at least R x 0.000291 wide.
 *
 * 2. JOHNSON'S CRITERIA. What a target must span, in line pairs, to be dealt with:
 *    detection ~1.0, recognition ~4.0, identification ~6.4, where ONE line pair is two
 *    resolvable elements (Johnson 1958; NATO planning guidance commonly quotes 1/3/6).
 *    Combined with (1) this gives a maximum RANGE for a target of a given size — and that
 *    range does not care how high the aircraft is. This is the ceiling on the far edge.
 *
 * 3. ATMOSPHERIC CONTRAST LOSS. Apparent contrast decays as C = C0 x exp(-sigma x L)
 *    (Koschmieder 1924; Beer's law), so a distant object fades into the background at a
 *    range set by the extinction coefficient. Duntley (JOSA 1948) is explicit that this
 *    applies to "the apparent contrast of objects on the ground as seen from the air",
 *    not only to horizontal sightlines — which is exactly this case.
 *
 * ── WHY THE CONE GROWS AND THEN SHRINKS ────────────────────────────────────────────
 * The near edge is geometric: the steepest useful look-down angle means the blind area
 * beneath grows as h / tan(NEAR_DEPRESSION), so it lengthens with altitude.
 * The far edge is NOT geometric at any useful altitude: it is capped by relationship (2),
 * which is a constant for a given target. So the visible band [near, far]:
 *
 *   grows while the geometry is the limiting factor (low altitude),
 *   stops growing once the acuity limit binds (~h = detection range x tan(FAR_DEPRESSION)),
 *   then NARROWS as the blind area eats into the fixed usable range,
 *   and closes entirely once near >= far.
 *
 * That last part is the counter-intuitive bit worth showing on a map: past a certain
 * altitude, climbing higher costs you usable view rather than gaining it. It is why an
 * aircraft wanting to watch something descends, and why the 350ER at patrol altitude has
 * an eye-limited cone of nothing at all — what it actually uses up there is the camera
 * pod, which is a different instrument with a different range (see SENSOR_ZOOM).
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────
 * A model, not a sensor spec. The fleet's camera fits and the crews' actual scan patterns
 * are not public, terrain occlusion is not modelled, and the atmosphere is a single
 * representative visibility rather than the real sky over Melbourne right now. Values are
 * named constants so they can be argued with; the UI calls the cone an estimate.
 */

/** 1 arcminute: the 20/20 minimum angle of resolution (Snellen / NIST). */
export const MAR_RAD = (1 / 60) * (Math.PI / 180) // 0.000291 rad

/** One line pair = two resolvable elements (Johnson). */
export const ELEMENTS_PER_LINE_PAIR = 2

/** Johnson line pairs: detection, recognition, identification. */
export const LP_DETECTION = 1.0
export const LP_RECOGNITION = 4.0
export const LP_IDENTIFICATION = 6.4

/** Target width in metres. 1 m covers a person or a small vehicle — the sized thing a
 *  crew is looking for. A car (4.5 m) is detectable 4.5x further; the number is a choice. */
export const TARGET_WIDTH_M = 1.0

/** Which task the cone represents. Detection: "there is something there". */
export const LINE_PAIRS_FOR_TASK = LP_DETECTION

/** The operator's figure: what a 20/20 eye resolves as something specific, unobstructed. */
export const MIN_VISIBLE_M = 80

/** Steepest usable look-down from the horizontal: the near edge is h / tan(this). */
export const NEAR_DEPRESSION_DEG = 60

/** Shallowest useful look-down before haze, terrain and the sightline flatten out. */
export const FAR_DEPRESSION_DEG = 12

/** Half the horizontal scan either side of the nose. */
export const HALF_FOV_DEG = 30

/** A cap so a very high aircraft cannot paint a cone across the whole viewport. */
export const MAX_RANGE_M = 8000

/** Representative clear-air visibility (Koschmieder meteorological range). Melbourne on a
 *  clear day runs 20-40 km; a hazy one 5-10. The default is not a live observation. */
export const HAZE_RANGE_M = 20_000

/** Below this the aircraft is on or near the ground: looking ahead means nothing. */
export const MIN_ALTITUDE_M = 15

/**
 * Optical magnification of the crew's sensor. 1 = unaided eye. An EO/IR turret with a zoom
 * lens multiplies the acuity-limited range roughly by its magnification, which is how a
 * 350ER can identify anything from 25,000 ft. Left at 1 so the default describes a person
 * looking out of the window, which is what was asked for; raise it when modelling a pod.
 */
export const SENSOR_ZOOM = 1

const DEG = Math.PI / 180

export interface VisionCone {
  /** Distance ahead where visible ground starts, in metres. */
  nearM: number
  /** Distance ahead where it ends, in metres. */
  farM: number
  /** Half-angle of the horizontal scan. */
  halfAngleDeg: number
  /** Why the far edge stopped where it did — useful for tooltips and for arguing with it. */
  limitedBy: 'geometry' | 'acuity' | 'haze' | 'range-cap'
}

export interface VisionOverrides {
  nearDepressionDeg?: number
  farDepressionDeg?: number
  halfFovDeg?: number
  minVisibleM?: number
  maxRangeM?: number
  targetWidthM?: number
  linePairs?: number
  sensorZoom?: number
  hazeRangeM?: number
}

/**
 * How far a target of `widthM` can be DETECTED, unaided, in clear air: the target must
 * span `linePairs` line pairs, i.e. 2 x linePairs resolvable elements of MAR_RAD each.
 */
export function acuityLimitedRangeM(
  widthM: number = TARGET_WIDTH_M,
  linePairs: number = LINE_PAIRS_FOR_TASK,
  sensorZoom: number = SENSOR_ZOOM,
): number {
  if (widthM <= 0 || linePairs <= 0 || sensorZoom <= 0) return 0
  return (widthM * sensorZoom) / (linePairs * ELEMENTS_PER_LINE_PAIR * MAR_RAD)
}

/**
 * The cone for an aircraft at `altitudeM`, or null when there is no useful forward view —
 * below the minimum altitude, or so high that the blind area has closed over the usable
 * range. Null is a real answer here, not a failure: it is what the model says about a
 * 25,000 ft aircraft and an unaided eye.
 */
export function visionConeForAltitude(
  altitudeM: number | null | undefined,
  o: VisionOverrides = {},
): VisionCone | null {
  if (typeof altitudeM !== 'number' || !Number.isFinite(altitudeM)) return null
  if (altitudeM < MIN_ALTITUDE_M) return null

  const nearDep = (o.nearDepressionDeg ?? NEAR_DEPRESSION_DEG) * DEG
  const farDep = (o.farDepressionDeg ?? FAR_DEPRESSION_DEG) * DEG
  if (nearDep <= farDep) return null

  const minVisible = o.minVisibleM ?? MIN_VISIBLE_M
  const maxRange = o.maxRangeM ?? MAX_RANGE_M
  const haze = o.hazeRangeM ?? HAZE_RANGE_M
  const acuity = acuityLimitedRangeM(
    o.targetWidthM ?? TARGET_WIDTH_M,
    o.linePairs ?? LINE_PAIRS_FOR_TASK,
    o.sensorZoom ?? SENSOR_ZOOM,
  )

  const nearM = Math.max(minVisible, altitudeM / Math.tan(nearDep))

  // The far edge is whichever limit is tightest: how far the sightline reaches down,
  // what the eye can resolve, and what the air will let through.
  const geometry = altitudeM / Math.tan(farDep)
  const candidates: Array<[number, VisionCone['limitedBy']]> = [
    [geometry, 'geometry'],
    [acuity, 'acuity'],
    [haze, 'haze'],
    [maxRange, 'range-cap'],
  ]
  const [farM, limitedBy] = candidates.reduce((a, b) => (b[0] < a[0] ? b : a))

  // Band closed: whatever is visible starts beyond where anything can be made out.
  if (farM <= nearM) return null

  return { nearM, farM, halfAngleDeg: o.halfFovDeg ?? HALF_FOV_DEG, limitedBy }
}

/**
 * The cone as an SVG path in PIXELS, nose at the origin, pointing "up" the screen
 * (negative y). The caller rotates it by heading, which is why nothing here knows a
 * direction.
 *
 * A truncated triangle, not a plain one: the near edge is a real line of ground, so the
 * shape begins at the visibility floor rather than at a point under the aircraft.
 */
export function visionConePathPx(cone: VisionCone, metresPerPixel: number): string {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return ''
  const half = Math.tan(cone.halfAngleDeg * DEG)
  const yNear = -cone.nearM / metresPerPixel
  const yFar = -cone.farM / metresPerPixel
  const xNear = (cone.nearM * half) / metresPerPixel
  const xFar = (cone.farM * half) / metresPerPixel
  const r = (n: number) => Math.round(n * 10) / 10
  return `M ${r(-xNear)} ${r(yNear)} L ${r(-xFar)} ${r(yFar)} L ${r(xFar)} ${r(yFar)} L ${r(xNear)} ${r(yNear)} Z`
}

/** Ground metres per screen pixel at a latitude, which every cone size depends on. */
export const WORLD_M_PER_PX_Z0 = 78271.51696
export function metresPerPixel(zoom: number, latDeg: number): number {
  return (WORLD_M_PER_PX_Z0 * Math.cos(latDeg * DEG)) / Math.pow(2, zoom)
}

/**
 * The altitudes where the shape of the answer changes, for the map's tooltip and for
 * anyone arguing with the constants. Below the first, geometry limits the far edge and
 * climbing extends it. Between them the acuity limit binds and climbing gains nothing.
 * Above the second the band has closed and there is no cone at all.
 */
export function coneCeilingM(o: VisionOverrides = {}): number {
  const acuity = acuityLimitedRangeM(
    o.targetWidthM ?? TARGET_WIDTH_M,
    o.linePairs ?? LINE_PAIRS_FOR_TASK,
    o.sensorZoom ?? SENSOR_ZOOM,
  )
  const farDep = (o.farDepressionDeg ?? FAR_DEPRESSION_DEG) * DEG
  const nearDep = (o.nearDepressionDeg ?? NEAR_DEPRESSION_DEG) * DEG
  const closesAt = acuity * Math.tan(nearDep) // where near edge reaches the acuity limit
  const opensTo = acuity * Math.tan(farDep) // where geometry stops being the limit
  return Math.max(closesAt, opensTo)
}
