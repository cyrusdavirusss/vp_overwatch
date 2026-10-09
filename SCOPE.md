# VP-Overwatch — Scope Tree

One canonical place for **what exists, what changed, what is next, and the rules that keep
it running**. Written for everyone working on this repo — human or bot. If you are an agent
picking this project up, read section 0 before you run anything.

Legend: `[DONE]` shipped and verified · `[WIP]` partly built · `[NEXT]` planned ·
`[BLOCKED]` waiting on something · `[FROZEN]` deliberately not touched

> **This file is published.** It is read by anyone who finds the repository. Keep it to
> features, layout and operating rules — never credentials, never a named file or commit
> that holds one, never a vulnerable package or the shape of a defect. Anything of that kind
> belongs in a private channel, not here.

---

## 0. Rules that break the app if ignored

These are not style preferences. Each one has already cost real downtime once.

- **This project uses pnpm.** Never run `npm install` / `npm ci` against it. Doing so
  desyncs `pnpm-lock.yaml`, so the service's `ExecStartPre=pnpm build` fails its dependency
  check and the app goes down. Use `pnpm add`, `pnpm update`, `pnpm install`.
- **Gate on the exact command the service runs, before restarting it.** Build-script
  approval lives in `pnpm-workspace.yaml` under `allowBuilds`, not in `package.json`; a
  package left unlisted there is a hard install error. So always run `pnpm build` and see it
  finish green **before** `systemctl --user restart vp-overwatch.service`. Restarting first
  turns a bad dependency change into an outage.
- **`main` is FROZEN. Do not merge into it, do not make it the default-facing branch, and do
  not rewrite its history.** It is deliberately far behind and is not maintained. Leave it
  alone; work on the deployed branch.
- **The deployed branch is `modern-vp-theme`.** That is what the local working tree and the
  live service build from.
- **Design tokens are not negotiable** (see the `vp-overwatch-design` skill / README):
  aviation amber `#FFB020` is for ACTIVE AIRCRAFT only; threat red `#FF4757` is for ground
  units and sightings; signal blue carries UI chrome; numerics in JetBrains Mono; no emoji,
  no gradients outside map terrain, no glassmorphism outside the status strip and sheet.
- **The map is the product.** Chrome must not compete with it — that is why the release
  flag is a dot, not a banner.

---

## 1. Live deployment

| Thing | Where |
|---|---|
| Web app | `vp-overwatch.service` (systemd --user), `:3100`, built from `Tactical/` |
| Public | https://vpoverwatch.com via `cloudflared-vp-overwatch.service` |
| LAN | http://192.168.1.109:3100 (bound 0.0.0.0) |
| ADSB ingest | `vp-overwatch-ingest.service` |
| Fuel collector | `vp-fuel-collector.service` |
| Waze relay | `vp-waze-wazeapi.service` (reads `tools/waze-relay/.env`) |
| Standalone output | `Tactical/.next/standalone` (what the service runs) |
| App config | `Tactical/.env.local` (relay secret and API keys — see DEPLOY.md) |

---

## 2. Workstream tree

```
VP-Overwatch
├── Rotational satellite view  ("Overwatch")
│   ├── [DONE] Orbit a ground unit on satellite imagery, clean exit
│   ├── [DONE] Hollow ghost models  (police car · speed camera · helicopter)
│   └── [WIP ] Helicopter ghost not exercised end-to-end — no live sighting data
├── Aircraft tracking
│   ├── [DONE] Dead-reckoned position + heading glide + sensor cone
│   └── [DONE] Helicopters hold a FIXED orientation while moving
├── Layout
│   ├── [DONE] One header on every platform — same row, fitted to the width
│   └── [DONE] Landscape scales the chrome to 50% instead of hiding it
├── Camera & location controls
│   └── [DONE] The locate control ("My Location") is ALWAYS in the cluster. It used
│              to be dropped whenever a live GPS fix existed, which removed the one
│              control that answers "where am I?" at exactly the moment it was
│              wanted — showing someone the map, there was no location button, so
│              Recenter got pressed instead and the camera, already on them, barely
│              moved. Manual coordinate entry is still offered only when the
│              browser genuinely cannot answer; that lives in onSetLocationPressed.
├── Release communication
│   └── [DONE] What's New release flag + panel (dot on the cluster, device-local seen flag)
├── Security
│   └── [DONE] Response headers and hardening — details held privately, not in this file
├── Dependency health
│   └── [NEXT] maplibre-gl major upgrade (see section 4)
├── Tooling
│   ├── [DONE] `npm run lint` works again (Next 16 removed `next lint`)
│   └── [NEXT] 50 pre-existing lint findings, overwhelmingly React 19 set-state-in-effect
└── Alerting & subscriptions        ← THE NEXT BIG PIECE
    ├── [DONE] Channel + provider abstraction (`lib/alerts/`)
    ├── [DONE] Sinch provider: SMS, voice, email behind one API
    ├── [DONE] Consent that records when and how, quiet hours, unsubscribe/opt-out
    ├── [DONE] Settings route (auth-gated) + subscribe route
    ├── [WIP ] Subscribe modal exists and is mounted — the SUBSCRIPTION BUTTON UX is next
    └── [NEXT] Remaining provider work, plan gating, and the button that exposes it
```

---

## 3. Shipped this cycle

**The rotational satellite view (Overwatch).**

This is the headline feature. Pick a ground unit — a police car or a speed camera — and launch
Overwatch from the map cluster. The map drops onto satellite imagery, tilts down to a shallow
angle so you are looking ACROSS the ground rather than straight down at it, and then slowly
sweeps a circle around the unit's reported position. A full revolution takes about a minute.

The point of the rotation is that a flat, top-down map hides everything that explains a
position: which side of a road a camera actually faces, what is between a car and the road,
which way the ground falls away. Turning the view through 360° at a low angle lets you read
the unit's surroundings from every direction in turn, so you can work out what it can see and
what it cannot. It is deliberately slow — fast enough to cover the circle, slow enough to
actually look at what is going past.

You can pan and zoom while it runs; the orbit only drives the bearing, so it never fights you
for the camera. It forces satellite imagery for as long as it is open, because the vector
basemaps flatten exactly the ground the view exists to inspect, and it restores whichever
basemap you were on when you close it. Closing also flattens the camera and returns it to
north, leaving you looking at where you were. An aircraft is a valid target too, and behaves
differently ON PURPOSE: no orbit. A helicopter is already travelling, and sweeping a circle
around something in motion is two motions fighting each other — so the bearing follows the
contact's heading, the view sits behind and parallel to travel, and the camera simply tracks the
contact. That is what makes the satellite ground beneath it readable. The launch control names which of the two it will open on, and is disabled only when
there is neither a selected aircraft nor a ground contact.

**Hollow ghost models.** While the view is open, a translucent outline of the unit stands on
its mark — a patrol car for a police unit, a camera badge for a speed camera, a helicopter
for a helicopter sighting. They are drawn as outlines rather than solids so the ground stays
readable straight through them.

**A tracking view for aircraft.** Opening the rotational view on an aircraft zooms in to a chase
level and follows the contact. It deliberately does NOT orbit: the subject is already moving, and
sweeping a circle around something in motion is two motions fighting each other.

The camera is a TRACK-UP chase, modelled on `gods-eye-view`'s Cesium camera, whose own comment
gives the trick: its HeadingPitchRange is built from the path's forward heading because that
"keeps the camera behind the vehicle". Its pitch is 78 against the ground orbit's 58 —
a chase wants the horizon and a survey wants the ground — which needs the map's pitch cap raised
from MapLibre's default 60, or it silently clamps back toward top-down. Framing is per role: a
helicopter at zoom 16.5, fixed wing two levels further out at 14.5, because a plane crosses the
state while a helicopter works locally.

**The bearing is offset ABEAM, not left behind the contact.** Taking the `gods-eye-view` trick
literally parks the camera behind the aircraft looking at its tail. `OVERWATCH_TRACK_SIDE_DEG`
(−90) is added to the contact's heading instead, so the view sits ABEAM and travels PARALLEL to
it, the ground sweeps across the frame, and the aircraft reads side-on. The operator asked for
exactly this — "a side angle going parallel with the heli or plane".

**The tracking view draws a SIDE ELEVATION, at 60 px, because a top-down glyph cannot show a side
view.** With `pitchAlignment: 'viewport'` the glyph stays screen-facing, so a top-down silhouette
under an abeam camera still reads as birdseye — the same mismatch that produced the earlier "it
lays flat" report. `aircraftMarkerSVG(role, size, 'side')` supplies side-profile art, and the
marker box grows via `.vp-ac-marker--tracking`. The SIZE is a legibility requirement, not a
preference: rendered to a review sheet, both side silhouettes collapsed into blobs at the map's
normal 36 px, became readable at 52, and were unambiguous at 60. The glyph swap is keyed
(`entry.glyphKey`) so a feed poll cannot re-parse the SVG and restart the rotor animation, and
`overwatchAircraftId` is a dependency of the marker effect so the swap happens on the mode change
rather than up to 3 s later.

**The fixed-wing side profile is RETIRED, not fixed.** It was the open item here — it never read as
a twin turboprop, and two rounds of redrawing failed the same way. The reason is structural, not a
drawing fault: in a true side view the far nacelle hides behind the fuselage, so a second engine is
genuinely invisible, and drawing one anyway read as a four-engine aircraft. `gods-eye-view` solves
the same problem the honest way — draw a real glTF airframe when the camera is close enough to see
it — so the tracking view now does that.

**The Overwatch airframe is a 3D model.** `lib/aircraft-3d.ts` renders `public/models/*.glb`
(copied from `gods-eye-view`; CC BY 4.0, credited in `public/models/NOTICES.md`) into a canvas
anchored to the contact's marker, with the canvas reproducing the map camera's own azimuth,
elevation and up vector so the airframe sits in the same perspective as the ground under it rather
than being pasted on flat. three.js is imported dynamically, so it is not in the bundle for a
session that never opens this view. The flat side glyph is hidden rather than removed and comes
straight back if the model fails to load.

**The fixed wing is a STAND-IN and the code says so.** `gods-eye-view` has no King Air; the closest
available silhouette is a Citation II — right planform (low wing, T-tail), wrong engines (jets, not
turboprops). Swapping in a real 350 mesh is the whole integration; the one number that may need
revisiting is the nose axis.

**Orient the mesh by MEASUREMENT, never by the README.** The meshes here all carry their fuselage on
**X**, not Z, and getting the axis wrong renders the aircraft END-ON under a side camera — a view
that still looks like a plausible aircraft, which is why it survived a review. The method that
settled it: the height profile is ASYMMETRIC along the fuselage axis and SYMMETRIC along the span
axis, and the fin sits at one extreme (the highest vertices of the helicopter all sit at x ≈ +5.7).
Both meshes measure nose = −X. A vision pass asked "which way does the nose point" contradicted
itself across two runs on the same image; the geometry did not.

**Both roles are CHASED, and that is one camera, not two.** The chase (bearing = heading) was
briefly offered to the fixed wing only, on the reasoning that a helicopter works a small area slowly
and the abeam view is what lets you read the ground it is circling — but the operator's call is the
chase for both, and it is the better answer for a reason worth recording: chasing is what a 3D
airframe is FOR. The camera sits behind, the nose points up the screen, the contact flies away, and
the ground runs out underneath it. This is gods-eye-view's own convention, whose `HeadingPitchRange`
is built from the forward heading precisely so the camera ends up behind the vehicle. The nose is
never re-oriented: it is always yawed onto its own heading, so it is the CAMERA that moves. The
earlier rejection of a chase ("still reads as birdseye") was correct for a FLAT glyph and does not
apply to a real airframe — which is exactly the thing the 3D model changed.

**The tracking glyph is therefore the TOP-DOWN one, for both roles**, since a silhouette seen from
behind is a plan view. The hand-drawn SIDE elevations are no longer reachable from the app; they
remain only for the marker review sheet (`scripts/render-markers.ts`). **Do not spend effort on the
side art** — it is not what ships, and two redraws of it were both judged worse than what they
replaced, because a flat side profile cannot be a side elevation under a tilted camera.

**The tracking view can hold on the OPERATOR's position instead of the contact.** A "MY LOCATION"
chip is offered beside the launch pill, and only while the view is open. It is disabled with no GPS
fix and says why in the tooltip rather than looking dead — the same `hasUserFix` guard the map's own
"you are here" dot uses, and the status bar already reads NO FIX in that state. It is deliberately a
REF and not a dependency of the camera effect: putting `user` in that effect's deps would re-run it
on every GPS update, and that effect tears down and rebuilds the view, so the 3D model would reload
and flash the airframe every ten seconds. Bearing, pitch and zoom are untouched by the toggle —
only the point under the camera changes.

**The tracked contact can no longer be dimmed by terrain.** MapLibre fades any marker to
`_opacityWhenCovered` (0.2) whenever it judges terrain to occlude the point the marker is drawn at —
and aircraft markers are drawn at their GROUND position, never at altitude, so at pitch 78 in hill
country the subject of the view went translucent. `marker.setOpacity('1','1')` is applied to the
tracked contact only, and restored on exit; the app's own silent/lost fade is applied to the inner
glyph and callout nodes, so it is untouched. Note the related limit: aircraft are NOT lifted to their
real altitude and should not be — 8,500 ft against a frame a few hundred metres across would put the
contact off screen entirely. Altitude is what the callout is for.

**Two MapLibre marker gotchas, both of which cost a round of "it still looks wrong":**

- Markers default to VIEWPORT rotation alignment, so they do not inherit the map's bearing. In a
  north-up view that is invisible, but in a track-up view the aircraft keeps pointing at its
  compass heading on screen while the map has that heading pointing up — it flies sideways.
  `rotationAlignment: 'map'` is required, and it is load-bearing.
- Setting `rotationAlignment` ALONE also pitch-aligns the glyph, because MapLibre derives
  `_pitchAlignment` from `_rotationAlignment` when pitchAlignment is left `'auto'`. That lays the
  marker flat into the ground with `rotateX(pitch)` — measured `rotateX(78deg) rotateZ(-97.56deg)`
  — and a squashed top-down helicopter lying on tilted ground reads as birdseye no matter how far
  the camera tilts. `pitchAlignment: 'viewport'` must be set explicitly alongside it.

While debugging, note that with pitch applied MapLibre writes `matrix3d(...)` rather than
`matrix(...)`; an angle helper that only parses `matrix` returns 0 and makes a correct build look
broken.

**The review fixture now crosses the state.** The `?mock=1` helicopter used to orbit a 2 km
circle over the CBD, which meant it barely moved: a measured 45-second trace covered 5px, so
it could not demonstrate anything about in-flight behaviour. It now flies a straight transit
from the western border to the far east — ~790 km at a real-world-plausible 150 kt and
1,500 ft, roughly a 2h50m crossing. The fixture is opt-in behind the query flag and labelled
`MOCK … (review only)` with the operator shown as `MOCK — not real traffic`, exactly as
before; nothing about this reaches a normal visitor. Speed and altitude were deliberately NOT
tuned for the eye, because the callout displays the fixture's own speed and a compressed clock
would show a helicopter doing jet speeds.

**One header on every platform.** The header used to shed groups at a breakpoint, so a phone
and a desktop rendered genuinely different headers — blown out on one, too small on the other.
It now renders the SAME row everywhere and measures itself against the width it is given, so
the whole thing always fits whatever it is running on.

**The location control tells the truth about where the operator is.** Three things used the
configured home point as if it were the operator's position whenever the device had no GPS
fix, and they are all fixed. The map's opening camera no longer opens zoomed in on the home
point — with no fix it opens wide over the coverage area, and the "you are here" dot stays
hidden, so nothing claims to know. "Nearest aircraft" and "nearest ground contact" no longer
rank by distance from the home point; they require a real fix and ask for one otherwise,
because ranking from somewhere the operator is not at produces a confident wrong answer.
A location press inside the rotational view now leaves the view first and waits a frame
before moving, so the view's own teardown cannot cancel the flight — measured after the fix:
0.00 km from the device's own position, 64.6 km from the home point.

**Landscape keeps the whole interface, shrunk to three quarters.** Turning a phone sideways used
to remove the header, the ON AIR strip, the control cluster and the status bar, leaving a bare map
behind a small tab; it then went to the other extreme, a FULL-BLEED map with half-scale chrome
floating over it. Both are gone. The chrome is scaled to **0.75** and stays **in flow** — the header
and the ON AIR strip keep the top, the status bar keeps the bottom, the map takes what is left, and
nothing floats over it. The map, and the aircraft and ground icons on it, stay full size. The zoom
is applied with `zoom`, not `transform: scale()`, because zoom changes LAYOUT: the boxes really do
occupy less space, which is what lets the map's offset follow them.

**Rotation itself was locked, and that was the actual reason it "stopped working".**
`public/manifest.json` shipped `"orientation": "portrait"`, so an installed PWA could not turn at
all — no amount of layout work would have shown. It is now `"any"`. If rotation ever appears broken
again, check that string FIRST: the layout can be perfect behind a portrait lock and it will look
exactly like a broken rotation handler.

**One consistent basemap across the whole state.** The self-hosted vector extract used to cover only
lon 144–146 / lat −38.5..−36.5 — Melbourne and central Victoria. Everything outside that box had no
vector data, so the app revealed an Esri satellite raster underneath to fill the void, which painted
a photographic seam across outer Victoria and made the map read as two different products stitched
together. The extract was rebuilt to cover the whole state — lon 140.9–150.1 / lat −39.2..−33.9,
169,503 tiles, z0–14, ~230MB — and `COVERAGE_BBOX` widened to match, so the raster is never needed
anywhere inside Victoria. Measured at Melbourne, Mildura, Gippsland, Portland, Wodonga and Mallacoota:
`esri-imagery visibility=none` at every one.

Regenerate it when a newer OSM build is wanted (about 15 seconds; the CLI is at
`github.com/protomaps/go-pmtiles`):

```
pmtiles extract https://build.protomaps.com/<DATE>.pmtiles public/victoria-full.pmtiles \
  --bbox=140.90,-39.20,150.10,-33.90 --maxzoom=14
```

**A fresh environment must regenerate that file.** `Tactical/public/*.pmtiles` is gitignored and
`NEXT_PUBLIC_PMTILES_URL` lives in the gitignored `.env.local`, so neither travels in the repo; what
ships is the remote Protomaps fallback in `lib/map-style.ts`. The old central-Victoria extract is
still on disk as a rollback but nothing points at it.

**Satellite imagery now appears in exactly two places:** while the rotational view is open, and while
a unit is selected. Both are contexts where the operator is reading the GROUND around something
specific, and the vector basemaps flatten exactly that. It is deliberately no longer revealed as a
stand-in for missing vector data. Verified end to end — vector by default, satellite on selection,
satellite in the tracking view, and restored on deselect: measured `vector → SATELLITE → SATELLITE →
SATELLITE (still selected, correct) → vector`.

**What's New** — a release flag in the map cluster, carrying a dot until the notes are opened
once on that device, opening a dismissible (non-modal) panel. Notes live as data in
`lib/whats-new.ts`; bump `WHATS_NEW_VERSION` and the flag reappears for everyone.

**Tooling** — `npm run lint` fixed (Next 16 removed `next lint`); eslint + flat config added;
unrs-resolver DENIED in `pnpm-workspace.yaml` because it is a lint-time-only resolver.

---

## 4. What is next

1. **Subscription button** — the next big update. The backend is largely there (`lib/alerts/`
   with a Sinch provider covering SMS, voice and email; consent, quiet hours, unsubscribe;
   settings and subscribe routes). What is missing is the operator-facing button and the
   remaining provider/plan work. **Before touching this, note the dependency update moved
   `twilio` 6.0.2 → 6.1.2 and its `axios` 1.18.0 → 1.20.0.** No Twilio or subscription *code*
   was modified.
2. **maplibre-gl major upgrade** — outstanding dependency maintenance. It is ESM-only and
   drops the global `GeoJSON` namespace, so it is a migration (~100 type errors across
   `map.tsx`, `map.NEW.tsx`, `page.tsx`) plus style-spec and icon-scaling render changes, not
   a version bump.
3. **Lint debt** — 50 findings, mostly architectural React 19 rules. Do not mass-fix; that
   means restructuring state flow in a live real-time map.

---

## 5. Known residuals

- **The helicopter ghost has not been exercised end-to-end** because `helicopter` is not in
  the Waze subtype mapping at all (it arises only from community sightings) and there were no
  such sightings. The model itself was verified directly; its orbit path is the same one
  verified live for the other two kinds.
- **The landscape chrome scale (0.75) has no automated regression test.** It was verified by
  measuring computed zoom values at several viewports; nothing fails the build if it changes.
- **Header readability at the small end is a judgement call.** Base text is 15px and the fit
  scale lands around 0.47–0.61 on a 320–412px phone, so effective text is roughly 7–9px
  there. Deliberate and consistent, but it is the tightest constraint in the layout.
- **OpenSky is returning no Victorian traffic at all right now.** Measured with the app's own
  credentials: the configured Melbourne box AND a whole-of-Victoria box both returned **0**
  aircraft, while all of Australia returned 18 — not one of them in Victoria. The app is
  polling correctly; the source is simply empty here. Worth knowing before diagnosing an empty
  map as a fault. Separately, the configured box is Melbourne metro
  (`144.0–145.8 / -38.6–-37.2`), not the state, so traffic outside it would not appear even if
  it existed.
- **The aircraft tracking view is verified on the fixture, not on real traffic.** Measured on the
  review helicopter and the review fixed-wing: the view opens on the selected contact rather than a
  ground report, frames the helicopter at zoom 16.5 and the plane at 14.5, holds pitch 78 with the
  pitch cap raised to 85, tracks up so the map bearing equals the contact's heading, keeps the
  contact framed as it travels, puts the nose 0deg from screen-up, and exits to pitch 0 with the
  basemap restored. The ground orbit was re-checked in the same pass and still rotates. What is
  UNVERIFIED is the same behaviour on live ADS-B traffic — there is none to test against, so every
  number above comes from the synthetic fixture.
- **A sighting published without coordinates still falls back to the home point.** The
  publisher uses `coords?.lat ?? userPosition.lat`, and `userPosition` resolves to the home
  point when there is no fix. In practice the operator taps the map so coordinates exist, but
  the fallback should not be a real place at all. Left alone here because it is the publish
  path and deserves its own decision.
- **In landscape the map's top offset is the measured chrome height, like every other
  orientation.** It was recorded here as deliberately 0 while landscape was full-bleed; that mode
  is gone, so a landscape map_top measuring 0 again would now be a REGRESSION, not a choice.
- **Landscape still uses the real viewport rather than the `screenDims` phone frame, and that is
  load-bearing.** `screenDims` renders a 393x852 PORTRAIT frame whenever the window is under 900px
  wide — right for previewing the phone layout on a desktop, wrong on a phone that has actually been
  turned, where it would draw a tall portrait frame inside a short landscape window.
