/**
 * Zoom arithmetic for the locate button.
 *
 * MapLibre's zoom is logarithmic: each +1 doubles the scale, so a percentage
 * change in apparent scale is a *logarithmic* step in zoom, not a linear one.
 * "Zoom in 25%" therefore means the scale grows by a quarter, which is
 * log2(1.25) ≈ 0.322 zoom levels — not 25 zoom levels, and not +0.25 either.
 *
 * Kept as a pure function so the arithmetic can be checked without a map.
 */
export const ZOOM_STEP_PERCENT = 25

/** Zoom level such that the map's scale is (1 + percent/100) times larger. */
export function zoomInByPercent(currentZoom: number, percent: number = ZOOM_STEP_PERCENT): number {
  return currentZoom + Math.log2(1 + percent / 100)
}

/** Same, capped at a maximum zoom (MapLibre's own limit for the style). */
export function zoomInByPercentCapped(
  currentZoom: number,
  maxZoom: number,
  percent: number = ZOOM_STEP_PERCENT,
): number {
  return Math.min(maxZoom, zoomInByPercent(currentZoom, percent))
}
