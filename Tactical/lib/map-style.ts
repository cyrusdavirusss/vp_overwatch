// MapLibre GL basemap style for VP-Overwatch.
//
// Strategy (per migration brief):
//   - Engine: MapLibre GL + Protomaps only. No token-gated providers.
//   - Basemap: self-hosted Protomaps PMTiles, read through the pmtiles
//     protocol registered once at the map root.
//   - Style: start from the Protomaps "dark" Flavor, then override its
//     Flavor colours into a tactical RADAR look — a near-black ground with
//     electric-cyan / signal-blue roads, labels and boundaries, echoing an
//     ADS-B radar scope. The basemap reads monochrome cyan-on-black so the
//     data overlays (aviation amber / threat red) still stand apart from it.
//   - All external URLs come from NEXT_PUBLIC_* env vars; when the PMTiles
//     URL is unset we fall back to the hosted Protomaps demo basemap so the
//     app still renders in preview.

import maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import { DARK, layers, type Flavor } from '@protomaps/basemaps'
import { Protocol } from 'pmtiles'

// Protomaps vector source name referenced by the generated layers.
const SOURCE = 'protomaps'

// Keyless fallback (Protomaps only) used when NEXT_PUBLIC_PMTILES_URL is
// unset. Points at the hosted Protomaps daily planet build, which is
// range-requestable — MapLibre only fetches tiles for the current viewport,
// never the whole archive. This is a preview safety net; production should
// set NEXT_PUBLIC_PMTILES_URL to a self-hosted Victoria/Australia extract
// (this repo ships one at public/victoria.pmtiles, wired via .env.local).
// The dated build rotates over time; bump it if it ever 404s.
const FALLBACK_PMTILES = 'https://build.protomaps.com/20251201.pmtiles'
const FALLBACK_GLYPHS =
  'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'
const FALLBACK_SPRITE =
  'https://protomaps.github.io/basemaps-assets/sprites/v4/dark'

// ── Radar palette ──────────────────────────────────────────────────────────
// A monochrome cyan-on-black scope. The ground stays near-black; everything
// drawn over it climbs a single electric-cyan ramp (dim → signal). Casings
// sink to the page base so lit roads read as hairline radar traces.
const RADAR = {
  base: '#03070C', // page base — casings sink to here
  ground: '#060C12', // earth / land — black scope, very slightly lifted
  water: '#020509', // darkest surface
  surface1: '#0A1B26', // glacier / sand / fill surfaces
  building: '#0C2230', // building fill — faintly visible
  fill2: '#12303F', // runway / raised fills
  natural: '#06121A', // parks / wood / scrub — near-black, no green

  // Cyan road ramp (dim locals → bright highways). Tuned bright so traces
  // read like the radar-scope reference: glowing electric cyan on black,
  // visible even on a phone in daylight (the previous ramp was near-invisible).
  traceDim: '#1E6E8C', // locals / service
  trace: '#2E9CBE', // minor / arterial hairline
  traceLit: '#46C2E6', // highways / boundaries
  signal: '#5FE0FF', // major arterials — brightest road trace (scope sweep)

  // Labels — cyan foreground tokens, halos sink to black.
  labelBright: '#9DF2FF', // city labels
  label: '#5AC8E5', // road / minor labels
  labelMuted: '#3A8AA5', // ocean / state / muted labels
} as const

let protocolRegistered = false

/**
 * Register the pmtiles:// protocol with MapLibre exactly once. Safe to call
 * on every map mount; subsequent calls are no-ops.
 */
export function registerPmtilesProtocol(): void {
  if (protocolRegistered) return
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

/**
 * Derive the VP-Overwatch radar Flavor from the Protomaps DARK flavor by
 * overriding every visible colour onto a cyan-on-black ramp. The ground is
 * near-black, roads are graded electric-cyan traces, labels are cyan, and no
 * other hue survives into the basemap.
 */
function radarFlavor(): Flavor {
  return {
    ...DARK,

    background: RADAR.base,
    earth: RADAR.ground,
    water: RADAR.water,

    // Natural cover — kept near-black, no green/saturation.
    park_a: RADAR.natural,
    park_b: RADAR.natural,
    wood_a: RADAR.natural,
    wood_b: RADAR.natural,
    scrub_a: RADAR.natural,
    scrub_b: RADAR.natural,
    glacier: RADAR.surface1,
    sand: RADAR.surface1,
    beach: RADAR.surface1,
    pedestrian: RADAR.surface1,
    zoo: RADAR.surface1,
    industrial: RADAR.surface1,
    hospital: RADAR.surface1,
    school: RADAR.surface1,
    military: RADAR.surface1,
    aerodrome: '#08222E',
    runway: RADAR.fill2,
    pier: RADAR.building,

    buildings: RADAR.building,

    // Roads — cyan traces, casings sink to the page base for a hairline glow.
    other: RADAR.traceDim,
    minor_service_casing: RADAR.base,
    minor_service: RADAR.traceDim,
    minor_casing: RADAR.base,
    minor_a: RADAR.trace,
    minor_b: RADAR.traceDim,
    link_casing: RADAR.base,
    link: RADAR.trace,
    major_casing_early: RADAR.base,
    major_casing_late: RADAR.base,
    major: RADAR.signal,
    highway_casing_early: RADAR.base,
    highway_casing_late: RADAR.base,
    highway: RADAR.traceLit,

    // Tunnels — dimmer than surface traces.
    tunnel_other_casing: RADAR.base,
    tunnel_minor_casing: RADAR.base,
    tunnel_link_casing: RADAR.base,
    tunnel_major_casing: RADAR.base,
    tunnel_highway_casing: RADAR.base,
    tunnel_other: '#0A2A38',
    tunnel_minor: '#0A2A38',
    tunnel_link: '#0C3242',
    tunnel_major: '#0C3242',
    tunnel_highway: '#103E52',

    // Bridges — match their surface-road counterparts.
    bridges_other_casing: RADAR.base,
    bridges_minor_casing: RADAR.base,
    bridges_link_casing: RADAR.base,
    bridges_major_casing: RADAR.base,
    bridges_highway_casing: RADAR.base,
    bridges_other: RADAR.traceDim,
    bridges_minor: RADAR.trace,
    bridges_link: RADAR.trace,
    bridges_major: RADAR.signal,
    bridges_highway: RADAR.traceLit,

    railway: RADAR.trace,
    boundaries: RADAR.traceLit,

    // Labels — cyan foreground tokens, halos sink to the page base.
    roads_label_minor: RADAR.label,
    roads_label_minor_halo: RADAR.base,
    roads_label_major: RADAR.label,
    roads_label_major_halo: RADAR.base,
    ocean_label: RADAR.labelMuted,
    subplace_label: RADAR.label,
    subplace_label_halo: RADAR.base,
    city_label: RADAR.labelBright,
    city_label_halo: RADAR.base,
    state_label: RADAR.labelMuted,
    state_label_halo: RADAR.base,
    country_label: '#4FB3CE',
    address_label: RADAR.label,
    address_label_halo: RADAR.base,

    // POI markers — neutralised to a single muted cyan, never semantic colour.
    pois: {
      blue: RADAR.labelMuted,
      green: RADAR.labelMuted,
      lapis: RADAR.labelMuted,
      pink: RADAR.labelMuted,
      red: RADAR.labelMuted,
      slategray: RADAR.labelMuted,
      tangerine: RADAR.labelMuted,
      turquoise: RADAR.labelMuted,
    },

    // Landcover raster tint — collapse to near-black so nothing reads coloured.
    landcover: {
      barren: RADAR.natural,
      farmland: RADAR.natural,
      forest: RADAR.natural,
      glacier: RADAR.surface1,
      grassland: RADAR.natural,
      scrub: RADAR.natural,
      urban_area: RADAR.ground,
    },
  }
}

/**
 * Build the complete MapLibre style. Sources, glyphs and sprite are all
 * env-driven with keyless Protomaps fallbacks.
 */
export function buildMapStyle(): StyleSpecification {
  const pmtilesUrl =
    process.env.NEXT_PUBLIC_PMTILES_URL?.trim() || FALLBACK_PMTILES
  const glyphs =
    process.env.NEXT_PUBLIC_MAP_GLYPHS_URL?.trim() || FALLBACK_GLYPHS
  const sprite =
    process.env.NEXT_PUBLIC_MAP_SPRITE_URL?.trim() || FALLBACK_SPRITE

  return {
    version: 8,
    glyphs,
    sprite,
    sources: {
      [SOURCE]: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: layers(SOURCE, radarFlavor(), { lang: 'en' }),
  }
}
