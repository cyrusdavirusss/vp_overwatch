// Winds-aloft lookup for the fuel model. Fetches a representative low-level
// wind (925 hPa ≈ 2,500 ft, typical police orbit altitude) for the operating
// area from Open-Meteo (no API key), cached. Failures degrade to calm — wind
// is a refinement to the fuel estimate, never a hard dependency.

import type { Wind } from '@/lib/fuel-model'
import { CALM } from '@/lib/fuel-model'

const KMH_TO_KT = 0.539957
const CACHE_TTL_MS = 20 * 60_000

let cache: { wind: Wind; at: number; lat: number; lng: number } | null = null
let inFlight = false

// Synchronous accessor used inside the hot poll loops — returns the last
// fetched area wind (or calm). Call refreshAreaWind() periodically to update it.
export function currentAreaWind(): Wind {
  return cache?.wind ?? CALM
}

// Fire-and-forget refresh; safe to call every poll. Skips if a fetch is already
// running, the cache is fresh, or the area hasn't moved much.
export function refreshAreaWind(lat: number, lng: number): void {
  const now = Date.now()
  if (inFlight) return
  if (
    cache &&
    now - cache.at < CACHE_TTL_MS &&
    Math.abs(cache.lat - lat) < 0.5 &&
    Math.abs(cache.lng - lng) < 0.5
  ) {
    return
  }
  inFlight = true
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&hourly=wind_speed_925hPa,wind_direction_925hPa&forecast_days=1`
  fetch(url, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json())
    .then((j) => {
      const idx = new Date().getUTCHours()
      const spdKmh = j?.hourly?.wind_speed_925hPa?.[idx]
      const dir = j?.hourly?.wind_direction_925hPa?.[idx]
      if (typeof spdKmh === 'number' && typeof dir === 'number') {
        cache = { wind: { dirFromDeg: dir, speedKt: spdKmh * KMH_TO_KT }, at: Date.now(), lat, lng }
      }
    })
    .catch((e) => console.warn('[wind] fetch failed:', e?.message))
    .finally(() => {
      inFlight = false
    })
}
