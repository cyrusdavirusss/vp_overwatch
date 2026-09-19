// Unit tests for the sensor-pointing estimate.
// Run: node --experimental-strip-types --test tools/sensor-pointing.test.ts
//
// These pin the properties that make the estimate honest rather than the arithmetic:
// an orbit must be recognised and its centre used, a straight track must NOT be mistaken
// for an orbit, a contact must nudge the bearing rather than capture it, contacts out of
// range must be ignored, and the uncertainty must be WIDER when the basis is weaker — since
// the whole point of returning a spread is that the map draws it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateSensorPointing,
  fitCircle,
  bearingDeg,
  distanceM,
  pathLengthM,
  normaliseDelta,
  SPREAD,
  MIN_FIXES,
} from '../lib/sensor-pointing.ts'
import type { TrackPoint } from '../lib/data.ts'

const M_PER_DEG_LAT = 111_320

/** Build a track of fixes on a circle around `centre`, starting at `startBearingDeg`. */
function orbitTrack(
  centre: { lat: number; lng: number },
  radiusM: number,
  steps: number,
  startBearingDeg = 0,
  sweepDeg = 350,
) {
  const track: TrackPoint[] = []
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180)
  for (let i = 0; i < steps; i++) {
    const b = ((startBearingDeg + (sweepDeg * i) / (steps - 1)) * Math.PI) / 180
    track.push({
      t: -240 + i * 3,
      ts: 1_700_000_000_000 + i * 3000,
      lat: centre.lat + (radiusM * Math.cos(b)) / M_PER_DEG_LAT,
      lng: centre.lng + (radiusM * Math.sin(b)) / mPerDegLng,
      alt: 1500 * 0.3048,
      hdg: (startBearingDeg + (sweepDeg * i) / (steps - 1) + 90) % 360,
      spd: 110,
      vs: 0,
    })
  }
  return track
}

/** Build a straight track heading `bearingDeg` from `start`, one fix every `stepM`. */
function straightTrack(start: { lat: number; lng: number }, bearingDeg: number, steps: number, stepM = 400) {
  const track: TrackPoint[] = []
  let p = { ...start }
  const b = (bearingDeg * Math.PI) / 180
  for (let i = 0; i < steps; i++) {
    track.push({ t: -240 + i * 3, ts: 1_700_000_000_000 + i * 3000, lat: p.lat, lng: p.lng,
      alt: 1500 * 0.3048, hdg: bearingDeg, spd: 120, vs: 0 })
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)
    p = {
      lat: p.lat + (stepM * Math.cos(b)) / M_PER_DEG_LAT,
      lng: p.lng + (stepM * Math.sin(b)) / mPerDegLng,
    }
  }
  return track
}

const CBD = { lat: -37.8136, lng: 144.9631 }

test('circle fit recovers a known centre and radius', () => {
  const centre = { lat: -37.75, lng: 145.05 }
  const track = orbitTrack(centre, 900, 36)
  const fit = fitCircle(track, track[track.length - 1].lat)
  assert.ok(fit, 'a circular track must fit')
  const errM = distanceM(fit!.centre, centre)
  assert.ok(errM < 60, `fitted centre within 60 m of truth, got ${errM.toFixed(1)} m`)
  assert.ok(Math.abs(fit!.radiusM - 900) < 60, `radius within 60 m, got ${fit!.radiusM.toFixed(1)} m`)
})

test('an orbit is recognised and the camera is put on the loop centre', () => {
  const centre = { lat: -37.75, lng: 145.05 }
  const track = orbitTrack(centre, 800, 30)
  const last = track[track.length - 1]
  const est = estimateSensorPointing({
    track, headingDeg: 90, groundSpeedKt: 110, reachM: 12_000,
  })
  assert.equal(est.basis, 'orbit-centre')
  assert.equal(est.confidence, 'high')
  const toCentre = bearingDeg(last, centre)
  const err = Math.abs(normaliseDelta(est.bearingDeg - toCentre))
  assert.ok(err < 12, `bearing within 12 deg of the true centre bearing, got ${err.toFixed(1)}`)
  // The fit recovers ~799.4 m: the track is generated in equirectangular metres and
  // the fit is done in the same frame, so a sub-metre disagreement is projection
  // distortion, not fit error. Assert the radius, not the last digit of it.
  assert.ok(Math.abs(est.orbitRadiusM! - 800) < 5, `radius ~800 m, got ${est.orbitRadiusM!.toFixed(1)} m`)
})

test('a straight track is NOT mistaken for an orbit', () => {
  const track = straightTrack(CBD, 0, 24)
  const est = estimateSensorPointing({ track, headingDeg: 0, groundSpeedKt: 140, reachM: 12_000 })
  assert.notEqual(est.basis, 'orbit-centre')
  assert.equal(est.basis, 'along-track')
})

test('a straight transit falls back to the recent course', () => {
  const track = straightTrack(CBD, 90, 12)
  const est = estimateSensorPointing({ track, headingDeg: 90, groundSpeedKt: 120, reachM: 12_000 })
  assert.equal(est.basis, 'along-track')
  assert.ok(Math.abs(normaliseDelta(est.bearingDeg - 90)) < 6, `expected ~90, got ${est.bearingDeg}`)
})

test('a contact in range nudges the bearing, it does not capture it', () => {
  const track = straightTrack(CBD, 0, 12)
  const last = track[track.length - 1]
  // a contact due east of the aircraft, well inside reach
  const contact = { lat: last.lat + 0.005, lng: last.lng + 0.0065 }
  const est = estimateSensorPointing({
    track, headingDeg: 0, groundSpeedKt: 120, reachM: 12_000, contacts: [contact],
  })
  assert.equal(est.basis, 'ground-contact')
  const deltaFromNose = Math.abs(normaliseDelta(est.bearingDeg - 0))
  const deltaFromContact = Math.abs(normaliseDelta(est.bearingDeg - bearingDeg(last, contact)))
  assert.ok(deltaFromNose > 5, 'moved off the nose')
  assert.ok(deltaFromContact > 5, 'did not snap onto the contact')
  assert.ok(deltaFromNose < 90, 'still on the aircraft side of the contact')
})

test('contacts beyond the sensor reach are ignored', () => {
  const track = straightTrack(CBD, 0, 12)
  const last = track[track.length - 1]
  const far = { lat: last.lat + 3, lng: last.lng } // ~330 km away
  const est = estimateSensorPointing({
    track, headingDeg: 0, groundSpeedKt: 120, reachM: 12_000, contacts: [far],
  })
  assert.equal(est.basis, 'along-track')
})

test('too few fixes falls back to the nose and says so', () => {
  const track = straightTrack(CBD, 45, MIN_FIXES - 1)
  const est = estimateSensorPointing({ track, headingDeg: 45, groundSpeedKt: 100 })
  assert.equal(est.basis, 'nose')
  assert.equal(Math.round(est.bearingDeg), 45)
  assert.match(est.note, /No track/)
})

test('an empty track is not an error', () => {
  const est = estimateSensorPointing({ track: [], headingDeg: null, groundSpeedKt: null })
  assert.equal(est.basis, 'nose')
  assert.equal(est.bearingDeg, 0)
})

test('uncertainty is wider when the basis is weaker', () => {
  assert.ok(SPREAD.orbit < SPREAD.contact, 'orbit is more certain than a contact')
  assert.ok(SPREAD.contact < SPREAD.alongTrack, 'contact is more certain than along-track')
  assert.ok(SPREAD.alongTrack < SPREAD.nose, 'along-track is more certain than a bare nose')
})

test('a slow aircraft with no closed track does not invent a direction', () => {
  const jitter: TrackPoint[] = Array.from({ length: 10 }, (_, i) => ({
    t: -240 + i * 3, ts: 1_700_000_000_000 + i * 3000,
    lat: CBD.lat + i * 0.00002, lng: CBD.lng, alt: 0, hdg: 200, spd: 0, vs: 0,
  }))
  const est = estimateSensorPointing({ track: jitter, headingDeg: 200, groundSpeedKt: 0 })
  assert.equal(est.basis, 'nose')
  assert.equal(Math.round(est.bearingDeg), 200)
})

test('path length and bearing helpers agree with the geometry they describe', () => {
  const track = straightTrack(CBD, 0, 5, 500)
  const len = pathLengthM(track)
  assert.ok(Math.abs(len - 2000) < 15, `4 x 500 m steps, got ${len.toFixed(0)} m`)
  assert.ok(Math.abs(normaliseDelta(bearingDeg(track[0], track[4]) - 0)) < 1)
})
