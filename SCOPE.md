# VP-Overwatch — Scope Tree

One canonical place for **what exists, what changed, what is next, and the rules that keep
it running**. Written for everyone working on this repo — human or bot. If you are an agent
picking this project up, read section 0 before you run anything.

Legend: `[DONE]` shipped and verified · `[WIP]` partly built · `[NEXT]` planned ·
`[BLOCKED]` waiting on something · `[FROZEN]` deliberately not touched

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
- **`main` is FROZEN. Do not merge into it, do not make it the default-facing branch.**
  It is deliberately 96 commits behind because its history contains secrets that a merge or
  a history rewrite would re-expose. Leave it alone.
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
| App secret | `Tactical/.env.local` (`WAZE_RELAY_SECRET`) — must match the relay's |

---

## 2. Workstream tree

```
VP-Overwatch
├── Ground view
│   ├── [DONE] Overwatch orbit view  (button, orbit, satellite, clean exit)
│   ├── [DONE] Hollow ghost models   (police car · speed camera · helicopter)
│   └── [WIP ] Helicopter ghost not exercised end-to-end — no live sighting data
├── Release communication
│   └── [DONE] What's New release flag + panel (dot on the FAB, device-local seen flag)
├── Security
│   ├── [DONE] Headers, poweredByHeader off, history no-store, secret removed from tree
│   ├── [DONE] next 16.3.8 — Next advisories cleared
│   ├── [BLOCKED] maplibre-gl critical advisory — sink never called; fix needs maplibre 6
│   └── [FROZEN] Secret in git history — not rewritten (see section 5)
├── Dependency health
│   ├── [DONE] Production advisories 41 → 2
│   └── [NEXT] The remaining 2 (1 moderate + the maplibre-gl above)
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

**Overwatch** — the ground-unit orbit view.
Select a police unit or a speed camera and launch it: the map centres on the reported
position, tilts to 58°, and sweeps the bearing at ~6°/s (a circle a minute). It forces the
satellite basemap while open (the vector views flatten the ground the view exists to read)
and restores your previous basemap on exit. Closing it flattens the pitch and returns the
bearing to north. With no ground contacts the control is disabled and says why.

Two defects were found by an independent adversarial review and fixed:
- exit left the map **stuck at pitch 58°** — the exit `easeTo` was cancelled by the north-up
  hold's `setBearing(0)`. Fixed with an immediate `setPitch(0)`, which has no animation to
  cancel.
- the ghost's markup was rebuilt on **every feed poll**, restarting its CSS animations and
  making it stutter. Now rebuilt only when the model or colour changes.

**Hollow ghost models** — a translucent outline stands on the mark: patrol car for
`marked`/`unmarked`/`rbt`, camera badge for `camera`, and an inline helicopter for
`helicopter`. The helicopter is inline rather than from an asset because the only rotary art
in the repo is aviation amber, which is reserved for active aircraft.

**What's New** — a release flag in the map cluster, carrying a dot until the notes are
opened once on that device, opening a dismissible (non-modal) panel. Notes live as data in
`lib/whats-new.ts`; bump `WHATS_NEW_VERSION` and the flag reappears for everyone.

**Security pass** — CSP gained `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
(deliberately still no `script-src`: that needs nonces through Next and the MapLibre worker).
`x-powered-by` removed. `/api/vicpol/history` now `no-store`. A 26-character credential that
was tracked in `Tactical/uploads/waze-relay/.env-36167e4a.example` removed from the tree.

**Dependency health** — production advisories **41 → 2**. The blocker was that
`@maplibre/geojson-vt` 6.x stopped supplying `@types/geojson`, so the `GeoJSON` UMD global
only ever arrived transitively and stopped resolving. Fixed by making the types package a
direct devDependency plus an explicit `types/geojson.d.ts` reference. Note: pinning
`geojson-vt` back is **not** an option — maplibre-gl 5.24.0 declares `^6.1.0` itself.

**Tooling** — `npm run lint` fixed (Next 16 removed `next lint`); eslint + flat config added;
unrs-resolver DENIED in `pnpm-workspace.yaml` because it is a lint-time-only resolver.

---

## 4. What is next

1. **Subscription button** — the next big update. The backend is largely there (`lib/alerts/`
   with a Sinch provider covering SMS, voice and email; consent, quiet hours, unsubscribe;
   settings and subscribe routes). What is missing is the operator-facing button and the
   remaining provider/plan work. **Before touching this, note that the dependency update
   moved `twilio` 6.0.2 → 6.1.2 and its `axios` 1.18.0 → 1.20.0** (that is what cleared the
   axios advisories). No Twilio or subscription *code* was modified.
2. **maplibre-gl 6 migration** — the route to zero critical advisories. It is ESM-only and
   drops the global `GeoJSON` namespace, so it is a migration (~100 type errors across
   `map.tsx`, `map.NEW.tsx`, `page.tsx`) plus style-spec and icon-scaling render changes, not
   a version bump.
3. **Lint debt** — 50 findings, mostly architectural React 19 rules. Do not mass-fix; that
   means restructuring state flow in a live real-time map.

---

## 5. Known residuals and deliberate non-actions

- **`main` stays behind on purpose** — old history exposes secrets, so it is never merged or
  rewritten. This is a decision, not debt.
- **The leaked 26-character relay secret is dead.** It was never the live value; both the app
  and the relay hold a matching 64-character secret that does not match it. Nothing needed
  rotating. It remains in git history.
- **Git history was NOT rewritten.** The credential is dead, so a rewrite would buy no
  security while changing every hash and breaking every clone of a public repo.
- **The maplibre-gl advisory is not reachable.** It is an XSS sanitiser bypass in
  `DOM.sanitize()`; this app never calls that — it builds `innerHTML` itself, which was
  audited.
- **The helicopter ghost has not been exercised end-to-end** because `helicopter` is not in
  the Waze subtype mapping at all (it arises only from community sightings) and there were no
  such sightings. The model itself was verified directly; its orbit path is the same one
  verified live for the other two kinds.
