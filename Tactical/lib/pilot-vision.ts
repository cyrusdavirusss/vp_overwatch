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
 * 350ER can identify anything from 25,000 ft.
 *
 * This default describes a person looking out of the window. The armoured aircraft in this
 * fleet carry a stabilised EO/IR turret, and modelling that is what EOIR_ZOOM_ESTIMATE is
 * for — see below.
 */
export const SENSOR_ZOOM = 1

/**
 * Modelled magnification of the fleet's EO/IR turret, for when the cone should represent
 * what the CAMERA can reach rather than what an unaided eye can.
 *
 * HOW THIS NUMBER IS ARRIVED AT. There is one published performance claim to anchor it:
 * the Air Wing says the camera reads registration numbers "from a long distance", and the
 * aircraft's own published operating band is 1,000-3,000 ft for the helicopters. Treating
 * identification of a plate character (45 mm) as Johnson identification (6.4 line pairs)
 * at the top of that band, 914 m:
 *
 *     magnification = range x linePairs x 2 x MAR / targetWidth
 *                   = 914 x 6.4 x 2 x 0.000291 / 0.045  ~= 76x
 *
 * At the bottom of the band, 305 m, the same sum gives ~25x. So the pod's effective
 * magnification lies somewhere in 25-80x; this takes the middle of that band. It is a
 * MODELLED figure standing in for an unpublished one, it is deliberately conservative
 * (a real turret's optical-plus-digital chain reaches higher), and it is a named constant
 * so it can be argued with. When the turret's actual lens is identified, replace it.
 */
export const EOIR_ZOOM_ESTIMATE = 50

/**
 * Range cap when modelling the sensor rather than the eye. The 8 km default exists so a
 * high aircraft cannot paint a cone across the viewport; a pod's acuity-limited reach is
 * tens of km and is really bounded by haze and the horizon, so the pod gets a larger cap.
 * HAZE_RANGE_M (20 km) is still the tighter of the two in clear air, which is correct.
 */
export const MAX_SENSOR_RANGE_M = 20_000

const DEG = Math.PI / 180

/**
 * The two airframes do not see the same way, and the difference is not decoration.
 *
 * A HELICOPTER can hover, so it can hold a fixed point under itself and depress its sensor
 * steeply — a small blind area beneath it, and a wide scan because it can also orbit and
 * point sideways. A FIXED WING must keep flying forward: looking steeply down while
 * travelling fast is not a useful view, so its useful look-down is shallower (a bigger
 * blind area behind the nose) but reaches further ahead, and its scan is narrower because
 * the sensor looks where the aircraft is going.
 *
 * These angles are reasoned choices, not measurements of this fleet's equipment. What the
 * model gets right is the CONSEQUENCE of the choice: the steeper a helicopter's near angle,
 * the higher it can climb before the blind area closes over the acuity-limited range, so
 * helicopters keep a usable cone to a higher altitude than the fixed wing does.
 */
export type VisionRole = 'rotary' | 'fixedwing'

export interface VisionProfile {
  nearDepressionDeg: number
  farDepressionDeg: number
  halfFovDeg: number
}

export const VISION_PROFILES: Record<VisionRole, VisionProfile> = {
  // Hovering: steep look-down, wide scan.
  rotary: { nearDepressionDeg: 75, farDepressionDeg: 10, halfFovDeg: 35 },
  // Forward flight: shallower look-down, narrower scan, further ahead.
  fixedwing: { nearDepressionDeg: 50, farDepressionDeg: 8, halfFovDeg: 25 },
}

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
  /** Which airframe is looking. Sets the default angles; individual angles still win. */
  role?: VisionRole
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

  const profile = o.role ? VISION_PROFILES[o.role] : undefined
  const nearDep = (o.nearDepressionDeg ?? profile?.nearDepressionDeg ?? NEAR_DEPRESSION_DEG) * DEG
  const farDep = (o.farDepressionDeg ?? profile?.farDepressionDeg ?? FAR_DEPRESSION_DEG) * DEG
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

  return { nearM, farM, halfAngleDeg: o.halfFovDeg ?? profile?.halfFovDeg ?? HALF_FOV_DEG, limitedBy }
}

/**
 * The cone as an SVG path in PIXELS, nose at the origin, pointing "up" the screen
 * (negative y). The caller rotates it by heading, which is why nothing here knows a
 * direction.
 *
 * A truncated triangle, not a plain one: the near edge is a real line of ground, so the
 * shape begins at the visibility floor rather than at a point under the aircraft.
 *
 * A MINIMUM RENDERED LENGTH IS APPLIED, and the reason is measured: at the zoom an operator
 * watches a whole state at, a genuine 50-200 m forward visibility renders 14-50 px, so the
 * cone was drawn true to scale and was a 20x14 px speck — which is precisely the "I can't
 * see it" complaint. Below MIN_CONE_PX the FAR edge is pushed out and the width recomputed
 * from the same half-angle, so the angle and proportions stay honest and the cone stays
 * attached to the aircraft (the near edge is never moved). Above the floor it is exact.
 * It is a legibility floor on length, and this comment is the record that it is a floor.
 */
export const MIN_CONE_PX = 26
export function visionConePathPx(cone: VisionCone, metresPerPixel: number): string {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return ''
  const half = Math.tan(cone.halfAngleDeg * DEG)
  const nearPx = cone.nearM / metresPerPixel
  const farPxRaw = cone.farM / metresPerPixel
  const farPx = Math.max(farPxRaw, MIN_CONE_PX, nearPx + 6)
  const yNear = -nearPx
  const yFar = -farPx
  const xNear = nearPx * half
  const xFar = farPx * half
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
  const profile = o.role ? VISION_PROFILES[o.role] : undefined
  const farDep = (o.farDepressionDeg ?? profile?.farDepressionDeg ?? FAR_DEPRESSION_DEG) * DEG
  const nearDep = (o.nearDepressionDeg ?? profile?.nearDepressionDeg ?? NEAR_DEPRESSION_DEG) * DEG
  const closesAt = acuity * Math.tan(nearDep) // where near edge reaches the acuity limit
  const opensTo = acuity * Math.tan(farDep) // where geometry stops being the limit
  return Math.max(closesAt, opensTo)
}

/**
 * The complete cone as an SVG string: the path, plus its gradient.
 *
 * THE GRADIENT IS THE POINT. The cone is most opaque at the aircraft and fades to nothing
 * at the far edge, because that is what it means: the near ground is what the crew can see
 * well, and the far edge is a modelled limit, not a boundary. A flat fill would draw a hard
 * edge the model does not have.
 *
 * The gradient id must be unique per marker — several of these SVGs are live on the map at
 * once, and duplicate ids resolve to whichever the browser parsed first, so one aircraft's
 * gradient would silently paint another's cone.
 */
export function visionConeSVG(
  cone: VisionCone,
  metresPerPixel: number,
  o: { idSuffix?: string; colour?: string } = {},
): string {
  const path = visionConePathPx(cone, metresPerPixel)
  if (!path) return ''
  // TEAL, not yellow: yellow is the breadcrumb trail's colour, and a cone in the same hue as
  // the track reads as part of the track. Deliberately not the airframe's role colour either
  // — the cone models what the pilot can see, not what the aircraft is, so it has to read as
  // its own layer. The gradient fades from the aircraft outward, so the near end is strongest.
  //
  // The gradient must stay here and NOT be replaced by a CSS fill on .vp-ac-vision path: CSS
  // overrides the fill="url(#...)" presentation attribute, and that bug silently killed the
  // gradient and left a flat 12% smear the operator could not see.
  const colour = o.colour ?? '45, 212, 191'
  const id = `vp-cone-${(o.idSuffix ?? 'x').replace(/[^a-zA-Z0-9_-]/g, '')}`
  const yNear = -cone.nearM / metresPerPixel
  const yFar = -cone.farM / metresPerPixel
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" overflow="visible">`
    + `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${yNear}" x2="0" y2="${yFar}">`
    + `<stop offset="0" stop-color="rgb(${colour})" stop-opacity="0.50"></stop>`
    + `<stop offset="0.5" stop-color="rgb(${colour})" stop-opacity="0.22"></stop>`
    + `<stop offset="1" stop-color="rgb(${colour})" stop-opacity="0"></stop>`
    + `</linearGradient></defs>`
    + `<path d="${path}" fill="url(#${id})"></path></svg>`
}
