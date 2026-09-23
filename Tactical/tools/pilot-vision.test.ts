// Unit tests for the forward-visibility cone.
// Run: node --experimental-strip-types --test tools/pilot-vision.test.ts
//
// These pin the properties that make the cone honest rather than the arithmetic that
// produced it: no cone where there is no forward view, never inside the operator's 80 m
// floor, the far edge limited by what the eye can resolve rather than by altitude, and —
// the counter-intuitive one — the usable band WIDENING with altitude, then narrowing,
// then closing. Numbers here come from the model's own constants (20/20 = 1 arcmin;
// Johnson detection = 1 line pair), not from taste.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  visionConeForAltitude,
  visionConePathPx,
  visionConeSVG,
  acuityLimitedRangeM,
  opticsHalfFovDeg,
  requiredZoomForRangeM,
  SENSOR_BASE_HALF_FOV_DEG,
  coneCeilingM,
  metresPerPixel,
  MIN_VISIBLE_M,
  LP_DETECTION,
  LP_IDENTIFICATION,
  TARGET_WIDTH_M,
} from '../lib/pilot-vision.ts'

const band = (alt: number) => {
  const c = visionConeForAltitude(alt)
  return c ? c.farM - c.nearM : 0
}

test('acuity sets a range that altitude cannot beat', () => {
  // 1 m target, detection (1 line pair = 2 elements of 1 arcminute each): ~1719 m.
  const detected = acuityLimitedRangeM(1, LP_DETECTION, 1)
  assert.ok(detected > 1600 && detected < 1800, `detection range was ${detected}`)
  // Identification needs 6.4 line pairs, so it is ~6.4x shorter — the reason a camera
  // helps and eyes do not.
  const identified = acuityLimitedRangeM(1, LP_IDENTIFICATION, 1)
  assert.ok(identified > 250 && identified < 290, `identification range was ${identified}`)
  // A bigger target is visible further, in proportion.
  assert.ok(acuityLimitedRangeM(4.5, LP_DETECTION, 1) > 7 * 1000)
  // And a zoomed sensor multiplies it, which is how a pod sees from altitude.
  assert.ok(Math.abs(acuityLimitedRangeM(1, LP_DETECTION, 10) - detected * 10) < 1e-6)
})

test('no forward view is claimed without an altitude', () => {
  assert.equal(visionConeForAltitude(null), null)
  assert.equal(visionConeForAltitude(undefined), null)
  assert.equal(visionConeForAltitude(Number.NaN), null)
})

test('an aircraft on the ground gets no cone', () => {
  assert.equal(visionConeForAltitude(0), null)
  assert.equal(visionConeForAltitude(10), null)
  assert.equal(visionConeForAltitude(15), null)
  assert.notEqual(visionConeForAltitude(40), null)
})

test('the near edge never comes closer than the 80 m floor', () => {
  for (const alt of [40, 100, 200, 300, 500, 1000, 2900]) {
    const c = visionConeForAltitude(alt)
    if (!c) continue
    assert.ok(c!.nearM >= MIN_VISIBLE_M, `near edge ${c!.nearM} m inside the floor at ${alt} m`)
    assert.ok(c!.farM > c!.nearM, 'far edge must be beyond the near edge')
  }
})

test('low down, climbing extends the cone (geometry is the limit)', () => {
  const at100 = visionConeForAltitude(100)!
  const at200 = visionConeForAltitude(200)!
  assert.equal(at100.limitedBy, 'geometry')
  assert.ok(at200.farM > at100.farM, 'a higher aircraft must see further while geometry limits')
})

test('higher up, the far edge stops at what an eye can resolve', () => {
  const at1000 = visionConeForAltitude(1000)!
  const at2000 = visionConeForAltitude(2000)!
  assert.equal(at1000.limitedBy, 'acuity')
  assert.equal(at2000.limitedBy, 'acuity')
  // Altitude no longer buys range: the same far edge, from twice the height.
  assert.equal(Math.round(at1000.farM), Math.round(at2000.farM))
  assert.ok(at1000.farM < acuityLimitedRangeM(TARGET_WIDTH_M) + 1)
})

test('THE COUNTER-INTUITIVE ONE: the usable band grows, then narrows, then closes', () => {
  const low = band(150)
  const mid = band(400)
  const high = band(1500)
  const veryHigh = band(2900)

  assert.ok(mid > low, `band should widen from 150 m to 400 m (${low} -> ${mid})`)
  assert.ok(high < mid, `band should narrow by 1500 m (${mid} -> ${high})`)
  assert.ok(veryHigh < high, `band should keep narrowing by 2900 m (${high} -> ${veryHigh})`)
  // And past the ceiling there is no useful view at all.
  assert.equal(visionConeForAltitude(3200), null)
  assert.equal(band(3200), 0)
})

test('the closing altitude is derivable, not a fudge factor', () => {
  // acuteness range / tan(60 deg) is where the blind area reaches the acuity limit.
  const ceiling = coneCeilingM()
  assert.ok(ceiling > 2800 && ceiling < 3100, `ceiling was ${ceiling} m`)
  assert.notEqual(visionConeForAltitude(ceiling - 200), null)
  assert.equal(visionConeForAltitude(ceiling + 200), null)
})

test('a 25,000 ft patrol aircraft has no unaided cone — that is the honest answer', () => {
  // 7,620 m. Uneided, a person at that height is far below the resolution limit, so the
  // model returns nothing rather than a reassuring shape. A camera pod is a different
  // instrument; raise sensorZoom to model one.
  assert.equal(visionConeForAltitude(7620), null)
  const withPod = visionConeForAltitude(7620, { sensorZoom: 20 })
  assert.notEqual(withPod, null)
  assert.ok(withPod!.farM > 3000, `pod cone should reach well out, got ${withPod!.farM}`)
})

test('the path is a closed pixel shape ahead of the nose', () => {
  const cone = visionConeForAltitude(1000)!
  const path = visionConePathPx(cone, 10)
  assert.match(path, /^M /)
  assert.match(path, /Z$/)
  const nums = path.match(/-?\d+(\.\d+)?/g)!.map(Number)
  assert.equal(nums.length, 8, 'four corners, two numbers each')
  assert.ok(nums[0] < 0 && nums[1] < 0, 'near-left must be left and ahead')
  assert.ok(nums[2] < 0 && nums[3] < 0, 'far-left must be left and ahead')
  assert.ok(nums[4] > 0 && nums[5] < 0, 'far-right must be right and ahead')
  assert.ok(nums[6] > 0 && nums[7] < 0, 'near-right must be right and ahead')
})

test('the cone halves in pixels when the scale doubles', () => {
  const cone = visionConeForAltitude(1500)!
  const at10 = visionConePathPx(cone, 10).match(/-?\d+(\.\d+)?/g)!.map(Number)
  const at20 = visionConePathPx(cone, 20).match(/-?\d+(\.\d+)?/g)!.map(Number)
  for (let i = 0; i < at10.length; i++) {
    const expected = at10[i] / 2
    assert.ok(Math.abs(at20[i] - expected) < 0.4, `point ${i}: ${at20[i]} vs ~${expected}`)
  }
})

test('an unusable scale yields an empty path rather than nonsense', () => {
  const cone = visionConeForAltitude(1000)!
  assert.equal(visionConePathPx(cone, 0), '')
  assert.equal(visionConePathPx(cone, -5), '')
  assert.equal(visionConePathPx(cone, Number.NaN), '')
})

test('metres per pixel falls as you zoom in, and follows latitude', () => {
  assert.ok(metresPerPixel(14, -37.8) < metresPerPixel(10, -37.8))
  assert.ok(metresPerPixel(12, 0) > metresPerPixel(12, -37.8))
})

test('a helicopter and a fixed wing do not see the same way', () => {
  const alt = 1000
  const heli = visionConeForAltitude(alt, { role: 'rotary' })!
  const wing = visionConeForAltitude(alt, { role: 'fixedwing' })!
  assert.ok(heli && wing)
  // Hovering lets a helicopter look down more steeply, so LESS ground is blind beneath it.
  assert.ok(heli.nearM < wing.nearM, `heli near ${heli.nearM} m vs fixed wing ${wing.nearM} m`)
  // It can also hold a wider scan because it can orbit and point sideways.
  assert.ok(heli.halfAngleDeg > wing.halfAngleDeg)
  // Consequence worth knowing: the helicopter keeps a usable cone higher up, because its
  // blind area grows more slowly. It is the near angle that decides the ceiling.
  const heliCeiling = coneCeilingM({ role: 'rotary' })
  const wingCeiling = coneCeilingM({ role: 'fixedwing' })
  assert.ok(heliCeiling > wingCeiling, `heli ceiling ${heliCeiling} m vs wing ${wingCeiling} m`)
})

test('the cone fades from the aircraft outward', () => {
  const cone = visionConeForAltitude(500, { role: 'rotary' })!
  const svg = visionConeSVG(cone, 10, { idSuffix: 'abc123' })
  assert.match(svg, /<linearGradient/)
  const opacities = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.equal(opacities.length, 3)
  assert.ok(opacities[0] > opacities[1], 'least transparent nearest the aircraft')
  assert.ok(opacities[1] > opacities[2], 'and fading further out')
  assert.equal(opacities[2], 0, 'gone at the far edge, which is a limit not a boundary')
  // The gradient has to be referenced, and unique per marker: two aircraft on the map at
  // once must not share an id or one silently paints the other's cone.
  assert.match(svg, /fill="url\(#vp-cone-abc123\)"/)
  assert.match(svg, /id="vp-cone-abc123"/)
  assert.notEqual(visionConeSVG(cone, 10, { idSuffix: 'other' }), svg)
})

test('a marker id with awkward characters cannot break the gradient id', () => {
  const cone = visionConeForAltitude(500)!
  const svg = visionConeSVG(cone, 10, { idSuffix: '7c4ef2/x y' })
  assert.match(svg, /id="vp-cone-7c4ef2xy"/)
  assert.match(svg, /fill="url\(#vp-cone-7c4ef2xy\)"/)
})

test('an unusable scale yields no SVG at all', () => {
  const cone = visionConeForAltitude(500)!
  assert.equal(visionConeSVG(cone, 0), '')
  assert.equal(visionConeSVG(cone, Number.NaN), '')
})


// ── WIDTH vs REACH: one lens, and you cannot have both ─────────────────────────────────
// These pin the fix for a real complaint: the King Air was drawn a 28-degree wedge reaching
// 20 km, because its cone took its WIDTH from the bearing uncertainty and its RANGE from the
// pod's acuity limit as if the two were independent. About 460 km2 of painted ground. A lens
// that reaches 20 km is a long lens, and a long lens is narrow.

test('the King Air narrows: a 28 degree along-track spread cannot reach 20 km', () => {
  const c = visionConeForAltitude(7620, { role: 'fixedwing', sensorZoom: 50, maxRangeM: 20_000, halfFovDeg: 28 })
  assert.ok(c, 'a cone should exist at 25,000 ft with the pod')
  assert.equal(c!.widthLimitedBy, 'optics', 'the width should be the optics, not the spread')
  assert.ok(c!.halfAngleDeg < 10, `expected a narrow field, got ${c!.halfAngleDeg}`)
  assert.ok(c!.halfAngleDeg > 4, `should not collapse to a needle, got ${c!.halfAngleDeg}`)
})

test('the King Air narrows at the mock altitude too', () => {
  const c = visionConeForAltitude(1829, { role: 'fixedwing', sensorZoom: 50, maxRangeM: 20_000, halfFovDeg: 28 })
  assert.ok(c!.halfAngleDeg < 12)
  assert.equal(c!.widthLimitedBy, 'optics')
})

test('THE REGRESSION GUARD: a low helicopter keeps its full uncertainty spread', () => {
  // At 1,000 ft the range is short, the magnification needed is near 1, and the optics cap
  // never binds — so the cone still shows the uncertainty, which is the whole point of it.
  for (const alt of [305, 914, 1219]) {
    const c = visionConeForAltitude(alt, { role: 'rotary', sensorZoom: 50, maxRangeM: 20_000, halfFovDeg: 16 })
    assert.ok(c)
    assert.equal(c!.widthLimitedBy, 'spread', `at ${alt} m the spread should stand`)
    assert.equal(c!.halfAngleDeg, 16, `at ${alt} m the helicopter cone must be unchanged`)
  }
})

test('an unaided eye is never capped: there is no lens to trade', () => {
  const c = visionConeForAltitude(1829, { role: 'fixedwing', sensorZoom: 1, maxRangeM: 20_000, halfFovDeg: 28 })
  assert.equal(c!.halfAngleDeg, 28)
  assert.equal(c!.widthLimitedBy, undefined)
})

test('the optics rule itself: longer reach, narrower field', () => {
  const near = opticsHalfFovDeg('fixedwing', 2_000, 50)
  const far = opticsHalfFovDeg('fixedwing', 20_000, 50)
  assert.ok(far < near, 'claiming a longer reach must cost field')
  assert.equal(requiredZoomForRangeM(20_000) > requiredZoomForRangeM(2_000), true)
  // the base field is the unaided one, so the cap can never exceed it
  for (const role of ['rotary', 'fixedwing'] as const) {
    assert.ok(opticsHalfFovDeg(role, 1_000, 50) <= SENSOR_BASE_HALF_FOV_DEG[role])
  }
})

test('a helicopter claiming a long reach is capped too — the physics is not role-specific', () => {
  const c = visionConeForAltitude(6_000, { role: 'rotary', sensorZoom: 50, maxRangeM: 20_000, halfFovDeg: 28 })
  assert.ok(c!.halfAngleDeg < 28)
  assert.equal(c!.widthLimitedBy, 'optics')
})
