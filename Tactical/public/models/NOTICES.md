# Bundled 3D Model Attribution

These `.glb` files are third-party visual assets, copied unmodified from the
`gods-eye-view` project (which is MIT for its own source; the models are NOT
covered by that license). Each remains under the license below, and **CC BY 4.0
requires the credit to stay visible wherever the models are used** — so this file
ships with them and the code that loads them names the airframe.

They are used by exactly one screen: the Overwatch aircraft tracking view
(`lib/aircraft-3d.ts`), which draws the real airframe when the map camera is close
enough to read it. Nothing else in the app uses them.

| File | Original work and creator | Source | License | Project modifications |
|---|---|---|---|---|
| `bell206.glb` | "Bell 206 JetRanger" by [terran4627](https://sketchfab.com/terran4627) | [Sketchfab model](https://sketchfab.com/3d-models/bell-206-jetranger-d2f7ba1d671549d4b26aaf834139a1dd) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | None here. Optimised upstream for God's Eye View: geometry/material simplification, textures resized to 256 px WebP, orientation/scale vertex-baked to real-world metres (Y-up, origin centred). |
| `citation2.glb` | "1990 Cessna Citation, Texture Detailed, Exterior" by [BlenderCommunityHead](https://sketchfab.com/aboodgoudagad) | [Sketchfab model](https://sketchfab.com/3d-models/1990-cessna-citation-texture-detailed-exterior-a78839624fe64900a8352cb23462350a) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | None here. Same upstream optimisation as above. |

`atr72.glb`, `airplane.glb` and `jet.glb` were evaluated for the fixed-wing role and are
**not shipped** — unused assets are weight. They remain available, with the same credits,
in `gods-eye-view`'s own `public/models/` directory.

## The fixed wing is a STAND-IN

A Cessna Citation II is a **twin jet**. The airframe it stands in for is the
Beechcraft King Air 350ER (POL35) — a **twin turboprop**. They share the low wing
and the T-tail, which is what carries the silhouette at the size this is drawn, but
the engines are wrong and the code says so rather than implying otherwise.
Replacing `/public/models/citation2.glb` with a real King Air 350ER mesh is the
entire integration; the measured nose axis in `lib/aircraft-3d.ts` is the only
number that may need updating.
