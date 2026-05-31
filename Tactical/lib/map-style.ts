// MapLibre GL basemap style for VP-Overwatch.
//
// Strategy (per migration brief):
//   - Engine: MapLibre GL + Protomaps only. No token-gated providers.
//   - Basemap: self-hosted Protomaps PMTiles, read through the pmtiles
//     protocol registered once at the map root.
//   - Style: start from the Protomaps "dark" Flavor, then override its
//     Flavor colours so the basemap reads near-black with hairline roads.
//     Signal blue / aviation amber / threat red are reserved for data
//     overlays and never appear in the basemap.
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

// ── Ink palette (mirrors colors_and_type.css; style JSON can't read CSS vars) ──
const INK = {
  ink0: '#0A0B0D', // page base — water/casings sink to here
  ink1: '#14161A',
  ink2: '#1C1F24', // buildings
  ink3: '#262A31',
  border: '#2A2F37', // arterial hairlines
  borderStrong: '#3A4049', // highways / boundaries
  borderSubtle: '#1E2229', // locals
  fg2: '#A6ADBB', // city labels
  fg3: '#6B7280', // road / minor labels
  label: '#5A6270', // ocean / muted labels (--map-label)
  water: '#07090C', // --map-water, the darkest surface
  land: '#11141A', // --map-land
  natural: '#0F1318', // parks / wood / scrub — barely above land, no green
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
 * Derive the VP-Overwatch ink Flavor from the Protomaps DARK flavor by
 * overriding every visible colour with a near-black ink token. Roads are
 * desaturated greys (hairline read), labels are muted foreground tokens,
 * and no saturated colour survives into the basemap.
 */
function inkFlavor(): Flavor {
  return {
    ...DARK,

    background: INK.ink0,
    earth: INK.land,
    water: INK.water,

    // Natural cover — kept near-black, no green/saturation.
    park_a: INK.natural,
    park_b: INK.natural,
    wood_a: INK.natural,
    wood_b: INK.natural,
    scrub_a: INK.natural,
    scrub_b: INK.natural,
    glacier: INK.ink1,
    sand: INK.ink1,
    beach: INK.ink1,
    pedestrian: INK.ink1,
    zoo: INK.ink1,
    industrial: INK.ink1,
    hospital: INK.ink1,
    school: INK.ink1,
    military: INK.ink1,
    aerodrome: '#0E1217',
    runway: INK.ink3,
    pier: INK.ink2,

    buildings: INK.ink2,

    // Roads — desaturated greys, casings sink to the page base for a hairline.
    other: INK.borderSubtle,
    minor_service_casing: INK.ink0,
    minor_service: INK.borderSubtle,
    minor_casing: INK.ink0,
    minor_a: INK.border,
    minor_b: INK.borderSubtle,
    link_casing: INK.ink0,
    link: INK.border,
    major_casing_early: INK.ink0,
    major_casing_late: INK.ink0,
    major: '#343A44',
    highway_casing_early: INK.ink0,
    highway_casing_late: INK.ink0,
    highway: INK.borderStrong,

    // Tunnels — dimmer than surface roads.
    tunnel_other_casing: INK.ink0,
    tunnel_minor_casing: INK.ink0,
    tunnel_link_casing: INK.ink0,
    tunnel_major_casing: INK.ink0,
    tunnel_highway_casing: INK.ink0,
    tunnel_other: '#181C22',
    tunnel_minor: '#181C22',
    tunnel_link: '#1B1F26',
    tunnel_major: '#1B1F26',
    tunnel_highway: '#1F242B',

    // Bridges — match their surface-road counterparts.
    bridges_other_casing: INK.ink0,
    bridges_minor_casing: INK.ink0,
    bridges_link_casing: INK.ink0,
    bridges_major_casing: INK.ink0,
    bridges_highway_casing: INK.ink0,
    bridges_other: INK.borderSubtle,
    bridges_minor: INK.border,
    bridges_link: INK.border,
    bridges_major: '#343A44',
    bridges_highway: INK.borderStrong,

    railway: INK.border,
    boundaries: INK.borderStrong,

    // Labels — muted foreground tokens, halos sink to the page base.
    roads_label_minor: INK.fg3,
    roads_label_minor_halo: INK.ink0,
    roads_label_major: INK.fg3,
    roads_label_major_halo: INK.ink0,
    ocean_label: INK.label,
    subplace_label: INK.fg3,
    subplace_label_halo: INK.ink0,
    city_label: INK.fg2,
    city_label_halo: INK.ink0,
    state_label: INK.label,
    state_label_halo: INK.ink0,
    country_label: '#7A828F',
    address_label: INK.fg3,
    address_label_halo: INK.ink0,

    // POI markers — neutralised to a single muted grey, never semantic colour.
    pois: {
      blue: INK.label,
      green: INK.label,
      lapis: INK.label,
      pink: INK.label,
      red: INK.label,
      slategray: INK.label,
      tangerine: INK.label,
      turquoise: INK.label,
    },

    // Landcover raster tint — collapse to near-black so nothing reads coloured.
    landcover: {
      barren: INK.natural,
      farmland: INK.natural,
      forest: INK.natural,
      glacier: INK.ink1,
      grassland: INK.natural,
      scrub: INK.natural,
      urban_area: INK.land,
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
    layers: layers(SOURCE, inkFlavor(), { lang: 'en' }),
  }
}
