/// <reference types="geojson" />

/**
 * Force @types/geojson into the TypeScript program.
 *
 * The map components reference `GeoJSON.Feature`, `GeoJSON.FeatureCollection` and
 * `GeoJSON.Polygon`, which @types/geojson provides via `export as namespace GeoJSON` —
 * a UMD global. Whether that global reaches the program depended on how the dependency
 * tree happened to hoist: an update that changed the shape of the tree underneath made
 * the namespace stop resolving across map.tsx, page.tsx and map.NEW.tsx, even though the
 * package was still installed.
 *
 * App code should not depend on hoisting luck, so the types package is (a) a direct
 * devDependency and (b) pulled in explicitly by the reference above rather than left to
 * TypeScript's automatic `@types` discovery.
 *
 * Verified by re-running the exact update that broke it: typecheck clean, `pnpm build`
 * green, and the map, markers, ghosts and orbit all still correct in a live browser.
 */
export {}
