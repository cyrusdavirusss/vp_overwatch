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
north, leaving you looking at where you were. With no ground contacts to orbit the control is
disabled and says so rather than silently doing nothing.

**Hollow ghost models.** While the view is open, a translucent outline of the unit stands on
its mark — a patrol car for a police unit, a camera badge for a speed camera, a helicopter
for a helicopter sighting. They are drawn as outlines rather than solids so the ground stays
readable straight through them.

**Helicopters hold a fixed orientation.** A rotary aircraft no longer turns its nose to follow
its track while it moves. The rotor keeps spinning and the sensor cone keeps slewing
independently, but the airframe itself stays put: at a three-second poll the heading is noisy,
and a helicopter that wheeled around on every refresh read as twitchy rather than
informative. Position and the sensor cone are what you actually read.

**One header on every platform.** The header used to shed groups at a breakpoint, so a phone
and a desktop rendered genuinely different headers — blown out on one, too small on the other.
It now renders the SAME row everywhere and measures itself against the width it is given, so
the whole thing always fits whatever it is running on.

**Landscape no longer hides the interface.** Turning a phone sideways used to remove the
header, the ON AIR strip, the control cluster and the status bar, leaving a bare map behind a
small tab. It now keeps every one of those on screen at half scale instead — the map, and the
aircraft and ground icons on it, stay full size.

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
- **The landscape chrome scale (0.5) has no automated regression test.** It was verified by
  measuring computed zoom values at several viewports; nothing fails the build if it changes.
- **Header readability at the small end is a judgement call.** Base text is 15px and the fit
  scale lands around 0.47–0.61 on a 320–412px phone, so effective text is roughly 7–9px
  there. Deliberate and consistent, but it is the tightest constraint in the layout.
