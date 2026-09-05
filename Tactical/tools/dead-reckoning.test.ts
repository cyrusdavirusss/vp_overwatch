import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deadReckon, MAX_EXTRAPOLATION_SEC } from '../lib/geo/dead-reckoning.ts'

test('no motion when heading/speed unknown or stationary', () => {
  const at = { lat: -37.8, lng: 144.9 }
  assert.deepEqual(deadReckon({ ...at, headingDeg: null, groundSpeedKt: 100 }, 10), at)
  assert.deepEqual(deadReckon({ ...at, headingDeg: 90, groundSpeedKt: null }, 10), at)
  assert.deepEqual(deadReckon({ ...at, headingDeg: 90, groundSpeedKt: 0 }, 10), at)
  assert.deepEqual(deadReckon({ ...at, headingDeg: 90, groundSpeedKt: 100 }, 0), at)
})

test('north heading moves latitude up by ~expected metres', () => {
  // 120 kt for 30 s ≈ 1852 m ≈ 0.01664° lat
  const p = deadReckon({ lat: 0, lng: 0, headingDeg: 0, groundSpeedKt: 120 }, 30)
  assert.ok(Math.abs(p.lat - 0.01664) < 0.0005, `lat=${p.lat}`)
  assert.ok(Math.abs(p.lng) < 1e-9)
})

test('east heading moves longitude; extrapolation capped', () => {
  const capped = deadReckon({ lat: 0, lng: 0, headingDeg: 90, groundSpeedKt: 120 }, 100000)
  const at30 = deadReckon({ lat: 0, lng: 0, headingDeg: 90, groundSpeedKt: 120 }, MAX_EXTRAPOLATION_SEC)
  assert.equal(capped.lng, at30.lng) // clamp holds
  assert.ok(capped.lng > 0)
})
