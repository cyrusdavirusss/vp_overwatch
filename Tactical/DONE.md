# VP·Overwatch — Definition of Done (v1.0 End State)

> The purpose of this document is to **draw a line**. VP·Overwatch is a solo home-lab
> project and can grow forever. "Done" here does not mean "no more ideas." It means:
> **the app does its job — accurately, instantly, and unattended — and I have stopped
> touching it except to keep it running.**
>
> v1.0 is declared done when every **MUST** box below is checked **AND** the app has run
> its stability window (see §7) with **no code changes and no manual restarts**.
> The "no code changes for 14 days" clause is the real signal: if I can't leave it alone,
> the checklist isn't actually complete, and the box I keep re-touching is the unfinished one.

Legend: `[ ]` not done · `[~]` partial / needs verification · `[x]` done & verified
Priority: **MUST** = required for v1.0 · **SHOULD** = strongly wanted · **WON'T** = explicitly out (see §9)

---

## 0. The headline requirements (the reason this app exists)

These three are non-negotiable. They are broken out again in §1–§3 as measurable criteria,
but stated here in plain language so the intent is never lost:

1. **Live locations must be extremely accurate.** A marker on the map must reflect where the
   aircraft / unit actually is *right now*, not where it was 30 seconds ago. Stale or
   drifting positions are a defect, not a limitation.
2. **Everything active must render perfectly and quickly.** Every live aircraft and every
   active ground unit is drawn correctly, in the right place, the right icon, the right
   colour/state — with nothing missing, nothing duplicated, nothing ghosting.
3. **A smooth start makes the app.** From the first tap/click the map and its live contents
   come up fast and clean. **No loading screens. No spinners. No "INITIALIZING MAP…". No BS.**
   The first frame the user sees is the real, populated map.

If all three are true and hold, the app *feels* finished. Everything else is plumbing.

---

## 1. Live-location accuracy — **MUST**

Target: a live aircraft's on-screen position is within a tight bound of its true position at
all times, and never visibly "jumps" or lags.

- [ ] **MUST** — Aircraft markers reflect a position no older than the accuracy budget below.
  Current poll cadence (`app/page.tsx` → `useRealtimeData`): aircraft **30 s**, reports **15 s**,
  relay **3 s**. A 30 s-old position of a helicopter at 120 kt is ~1.8 km off — **too coarse for
  "extremely accurate."** Close this one of these ways (pick and record the decision):
  - [ ] Reduce the active-aircraft poll interval (e.g. 5–10 s) for the in-view set, **or**
  - [ ] Client-side dead-reckoning / interpolation between polls using last known
        heading + speed (smooth the marker along its track instead of snapping), **or**
  - [ ] Push/stream updates (WebSocket via the `ws` dep already present) for the fast loop.
- [ ] **MUST** — Marker motion between updates is **smooth** (animated/interpolated), never a
      teleport. Heading rotation is applied continuously, not stepped.
- [ ] **MUST** — Position accuracy is **source-aware**: ADS-B positions treated as precise;
      MLAT / Mode-S treated as degraded and visibly flagged (the `AircraftDetail` panel already
      distinguishes `adsb` / `mlat` / `mode_s` — the *map marker* must reflect the same
      confidence, e.g. dimmed / uncertainty ring for non-ADS-B).
- [ ] **MUST** — The **(0,0) coordinate guard** rejects null-island fixes before they ever
      reach the map (already in the pipeline — verify no live marker can render at 0,0).
- [ ] **MUST** — User's own position uses the live GPS fix when granted (`useClientLocation`);
      no marker drift when GPS updates.
- [ ] **SHOULD** — Define and document the numeric budget: *"a live ADS-B marker is within
      **X metres** of truth **P%** of the time."* Fill in X and P, then measure against a
      handful of real flights before checking this box.
- [ ] **SHOULD** — Breadcrumb trails (`/api/aircraft/breadcrumbs/[hex]`) line up with the live
      marker head — no gap, no overshoot on selection/zoom.

**Acceptance test:** watch 3–5 real aircraft for several minutes each. Markers track smoothly,
stay visually locked to their true path (cross-check against a second ADS-B source), and never
jump, ghost, or sit stale. Non-ADS-B contacts are clearly marked as lower-confidence.

---

## 2. Complete & correct rendering of everything active — **MUST**

Target: whatever is live *is on the map*, exactly once, correct in every visual dimension.

- [ ] **MUST** — Every active aircraft returned by `/api/aircraft/active` renders a marker.
      Count on map == count of active contacts. No silent drops.
- [ ] **MUST** — Every active ground unit / report renders. The **45-min ground-unit sliding
      TTL** correctly ages units out; nothing lingers past TTL, nothing vanishes early.
- [ ] **MUST** — **No duplicate markers** (the same hex / uuid never draws twice), including
      across a poll refresh or a hot re-render.
- [ ] **MUST** — Correct **icon per role** (rotary vs fixed-wing silhouette, `lib/markers.ts`)
      and correct **state colour**: cyan = active aircraft, red = confirmed threat,
      green = reported/unconfirmed. State changes recolour the existing marker in place.
- [ ] **MUST** — Aircraft lifecycle states render distinctly and correctly: **active**,
      **silent** (MLAT/Mode-S only), **lost** (off-radar, plausibly airborne), **landed**
      (fuel-exhausted or low-and-slow). The fuel-physics silent-expiry removes truly-dead
      contacts; no "phantom silents" (regression fixed in `c6e84df` — must stay fixed).
- [ ] **MUST** — **First click on any icon** opens its detail instantly and correctly
      (`AircraftDetail` / `ReportDetail`) — right aircraft, live fields, no wrong-target, no
      lag, no empty panel that fills in a beat later. Selection focus/zoom uses the *live*
      position (regression fixed in `84748f8` — must stay fixed).
- [ ] **MUST** — Markers stay correctly geo-anchored through pan / zoom / rotate — no lag,
      no drift off their coordinate, no pop-in at zoom thresholds.
- [ ] **SHOULD** — Marker layer stays smooth (no jank) with the realistic maximum contact
      count for the coverage area. Record the number it was tested at.
- [ ] **SHOULD** — Filters (`FilterPanel`) add/remove markers cleanly with no orphan glyphs.

**Acceptance test:** with a busy sky, reconcile the map against the raw feed: every active
contact present exactly once, right icon, right colour, right state; tap several — each opens
the correct live detail immediately.

---

## 3. Smooth, instant start — no loading screens — **MUST**

Target: the app opens straight into a populated, interactive map. The user never watches it load.

- [ ] **MUST** — **Kill the map loading screen.** `components/lazy-map.tsx` currently renders
      `"INITIALIZING MAP…"` while it dynamically `import('./map')`, plus a 12 s timeout and a
      RETRY state. For a smooth start this transient text must not be a visible phase in the
      normal path. Options (pick & record):
  - [ ] Preload / eager-load the map module so it's ready before first paint, **or**
  - [ ] Replace the text with the **already-styled map background** (`--map-bg`) so the
        transition is invisible (dark canvas → same dark canvas with content), **or**
  - [ ] Server-render the shell so first paint *is* the map frame.
  - Keep the error/RETRY branch — that's a real failure path, not the happy path.
- [ ] **MUST** — **First contentful frame is the real map**, not a spinner, splash, blank
      black screen, or skeleton. (Historic black-map / blank-shell bugs: `d17c65f`,
      `62ae60a` — must stay fixed.)
- [ ] **MUST** — **Live contents appear with the map, not after it.** No perceptible window
      where the map is up but empty and markers "arrive." First markers are present on (or
      within a hair of) first paint — seed from last snapshot (`~/.vp-overwatch/store.json`)
      so there's data to draw immediately rather than waiting on the first poll.
- [ ] **MUST** — First-icon interaction works on the very first frame the map is interactive
      (ties to §2 first-click requirement).
- [ ] **MUST** — **App-shell is never staler than the deploy.** The one-year app-shell cache
      bug (`d17c65f` — phones served the old black-map build) must stay fixed: shell HTML
      `no-store`/short-TTL, only fingerprinted assets long-cached.
- [ ] **SHOULD** — Cold-start budget met: **time-to-interactive-map ≤ T seconds** on the
      target phone over the home network. Pick T (suggest ≤ 2 s), measure, then check.
- [ ] **SHOULD** — Warm start (returning to a backgrounded app / Capacitor APK → :3100) is
      effectively instant and shows last-known state immediately.

**Acceptance test:** cold-open on the phone and on desktop several times. Every time: map is up
and populated fast, no spinner/splash/blank/"INITIALIZING" flash, first tap works immediately.

---

## 4. Functional acceptance — the app must — **MUST**

- [ ] **MUST** — Dual ADS-B poll loops run continuously; the **police-owned-by-fast-loop**
      invariant holds (fast loop owns police aircraft; no ownership races/duplication).
- [ ] **MUST** — Fuel-burn model (`lib/fuel-model.ts`) + winds-aloft (`lib/wind.ts`) drive
      silent-aircraft expiry; validated against **N** real cases (pick N, e.g. 5) where a
      known aircraft went dark and dropped off at a physically sensible time.
- [ ] **MUST** — Fuel timer survives restart/deploy (persisted in the store snapshot) — a
      mid-flight tank is **not** reset to 100 % on restart.
- [ ] **MUST** — Reports / Waze alert ingest + expiry behave correctly (`/api/waze/*`,
      `lib/community-reports.ts`); the report-expiry regression (`1d508bd`) stays fixed.
- [ ] **MUST** — Relay/feed status is live and truthful (`/api/relay/status`, `MlatBanner`);
      `~/.vp-overwatch/last-ingest.txt` watchdog reflects real ingest.
- [ ] **MUST** — Sortie history persists across restarts (bounded to `MAX_SORTIE_HISTORY`).
- [ ] **MUST** — Full restart via the systemd user service comes back clean and rehydrates
      from the disk snapshot with no manual steps.
- [ ] **SHOULD** — VicPol history view (`/vicpol-history`, `/api/vicpol/history`) renders.
- [ ] **SHOULD** — Route alerts (`useRouteAlerts` / `RouteAlertPanel`) fire correctly.
- [ ] **SHOULD** — Subscribe / notification path (`/api/subscribe`, Twilio) works end-to-end
      **or** is explicitly deferred to §9.

---

## 5. Non-functional / operational acceptance — **MUST**

- [ ] **MUST** — Runs on `:3100` for the **stability window (§7)** with **zero manual
      restarts**.
- [ ] **MUST** — Memory stays within a written bound over the window (a leak = not done).
      Record the bound (e.g. RSS < X MB after 14 days). The store is capped
      (`MAX_SORTIE_HISTORY`, track slices) — confirm heap/snapshot stay flat.
- [ ] **MUST** — CPU idle load stays within a written bound between polls.
- [ ] **MUST** — `/api/healthz` returns ok; add/keep a deeper `/api/dashboard/health` check
      that also asserts the feed is fresh (last-ingest within threshold), so "process up but
      feed dead" is caught.
- [ ] **SHOULD** — Survives loss of the upstream ADS-B feed gracefully: last-known state
      holds, banner shows degraded, auto-recovers on feed return — no crash, no blank map.
- [ ] **SHOULD** — Survives a phone sleep/wake and network flap without a broken map.

---

## 6. Build / deploy / documentation acceptance — **MUST**

- [ ] **MUST** — Deploy path is documented and followed **every time**:
      **`npm run build`** (= `next build` + `copy-standalone.mjs` + `sync-dist.mjs`) then
      restart the service. **Never a bare `next build`** — it desyncs the running standalone
      server → 500 chunk errors → blank/cached page. This hazard is written here on purpose.
- [ ] **MUST** — `.env.local` is correct and non-duplicated (watch the duplicate PMTILES var
      gotcha); `.env.example` documents every required var.
- [ ] **MUST** — README lets a future-me stand the whole thing up from scratch (feed config,
      env, build, systemd unit, ports).
- [ ] **MUST** — The data-pipeline model (dual loops, fuel physics, winds-aloft, silent
      expiry, TTLs, ownership) is documented well enough to trust the numbers without
      re-deriving them (`docs/adsb-dashboard-*.md` — confirm it's current).
- [ ] **SHOULD** — Capacitor Android wrapper builds and points at the right host (APK → :3100).

---

## 7. The stability gate (the actual finish line)

> **v1.0 is DONE when:** every **MUST** box above is checked **AND** the app has run
> **14 consecutive days** on `:3100` with **no code changes** and **no manual restarts**,
> holding within the memory/CPU bounds, with the feed watchdog never firing a false "dead."

Pick the window and commit to it: **14 days** (recommended) · 7 days (min) · 30 days (strict).

- [ ] Window chosen: **______ days**
- [ ] Start date: **__________**  →  End date: **__________**
- [ ] Completed clean (no code changes, no manual restarts) — **v1.0 DONE**

If you touch the code during the window, the clock resets **and** you note *why* — that note
names the one box that wasn't really done.

---

## 8. Sign-off checklist (fill at declaration)

- [ ] §1 Live-location accuracy — all MUST ✔ + numeric budget recorded
- [ ] §2 Complete/correct rendering — all MUST ✔
- [ ] §3 Smooth instant start — all MUST ✔ (no loading screen in the happy path)
- [ ] §4 Functional — all MUST ✔
- [ ] §5 Operational — all MUST ✔
- [ ] §6 Build/deploy/docs — all MUST ✔
- [ ] §7 Stability window — completed clean
- [ ] I have **stopped adding features**. Remaining ideas are logged in §9 or a backlog, not
      treated as debt.

**v1.0 declared done on: __________**

---

## 9. Explicitly OUT of scope for v1.0 — **WON'T** (this is what makes it end)

Naming these is what turns "endless" into "finished." Anything here is **not** unfinished work.

- **WON'T** — Covert Waze anti-bot scrapers. Standing carve-out; not built here, not in v1.
- **WON'T** — Multi-user accounts / auth / public hosting beyond the home lab.
- **WON'T** — Cloud deployment, horizontal scaling, external database (in-memory store +
      disk snapshot is the v1 architecture, by design).
- **WON'T (v1)** — Historical playback / time-travel beyond the existing scrubber scope.
- **WON'T (v1)** — Push/SMS notification expansion beyond the current subscribe path
      (keep or cut — decide once, record here).
- **WON'T (v1)** — Location-based alerts beyond current route alerts
      (`docs/out-of-scope/location-based-alerts.md`).
- **WON'T (v1)** — Any new *feature type* not already in §1–§6. New feature ideas go to a
      backlog file, not into v1.

> Rule of thumb: if it isn't in a **MUST/SHOULD** box above and isn't in this list, there
> should be almost nothing left. That emptiness *is* the end state.

---

## 10. After v1.0 — maintenance mode

Once §7 passes, the project is in maintenance mode: work is **optional, not obligatory**.
Allowed without "reopening" the project: security/dependency updates, feed-source fixes,
crash fixes. Anything bigger is a deliberate **v1.1** with its own short MUST list — not a
reason to feel the project is unfinished.
