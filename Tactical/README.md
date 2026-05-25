# VP-Overwatch Design System

A mobile-first situational awareness app that fuses two real-time data streams onto one map:

1. **ADS-B** law-enforcement aircraft — helicopters and fixed-wing surveillance, with live position, altitude, heading, speed, trail, and inferred operator.
2. **Waze community reports** — ground-level police presence (marked, unmarked, hidden, roadside stops, checkpoints) with confirmation counts and freshness.

The app is for informed civilians who want to drive, ride, and navigate more carefully when enforcement is active. Treat the user as competent. No hand-holding.

## Sources & references

- **Reference codebase:** `Flight-Tracker-Elite/` (local mount; if it stops connecting, re-attach via Import → Local Folder)
- **Public repo:** https://github.com/cyrusdavirusss/VP-Tracker
- **Aesthetic anchors:** ATAK / WinTAK, ForeFlight, Flightradar24 Gold, Palantir Gotham / Foundry, Linear, Arc, Mapbox "Navigation Night," Stamen "Toner," Bellingcat investigative tooling.

> **Note for the reader:** The codebase mount wasn't reachable during initial buildout. The visual system below is built from the brief and the references above. When the codebase is reachable, data shapes (callsign format, report categories, polling cadence) should be reconciled against it.

## What's in this folder

| Path | What it is |
|---|---|
| `README.md` | This file — system overview, content fundamentals, visual foundations, iconography |
| `colors_and_type.css` | All design tokens (color, type, spacing, radii, shadow, motion) as CSS variables for both themes |
| `fonts/` | Inter + JetBrains Mono webfont references |
| `assets/` | Logos, icons, map textures |
| `preview/` | Small HTML cards that populate the Design System tab (color, type, components, etc.) |
| `ui_kits/app/` | The mobile app prototype — map view, aircraft detail, report detail, scrubber, filters |
| `SKILL.md` | Skill manifest so this folder works as a Claude Code skill |

---

## CONTENT FUNDAMENTALS

VP-Overwatch's copy carries the voice of a domain tool, not a consumer app. Reference points: aviation METAR/TAF readouts, military situation reports, Linear's product copy.

### Tone

**Terse. Precise. Time-stamped.** No marketing language. No exclamation marks. No emoji anywhere in the UI. Numbers carry meaning — they are not decoration.

### Person

**Second person, rarely.** Most copy is descriptive rather than addressed: "12 active aircraft" not "You have 12 aircraft." When addressing the user directly, "you" — never "we." There is no "we" — the app is a tool, not a partner.

### Casing

- **Section headers and chrome:** Title Case ("Active Aircraft," "Layer Controls")
- **Inline labels and metadata:** lowercase ("alt," "spd," "hdg," "last seen")
- **Status and state:** UPPERCASE for hard states only ("LIVE," "STALE," "OFFLINE"). Soft states use sentence case ("Updating," "Standby").
- **Identifiers (callsigns, ICAO hex):** UPPERCASE in monospace, always ("N911LA," "AE5F8C")

### Number & unit treatment

- **All numerics in monospace with tabular-nums.** Even in body copy.
- Units sit tight against the number with a thin space, not full space: `12.4kts`, `1,250ft`, `285°`.
- Compass bearings always 3-digit, zero-padded: `085°` not `85°`.
- Times in 24h, with seconds when freshness matters: `14:32:08`.
- Relative times collapsed: `2m ago`, `47s ago`, `>1h`.

### Status language

A controlled vocabulary. Pick one term, use it everywhere.

| State | Word | When |
|---|---|---|
| Live data | `LIVE` | Last poll <60s ago |
| Aging | `<2m` | 60–120s |
| Stale | `STALE` | 2–10m |
| Lost | `LOST` | >10m, no broadcast |
| Confirmed | `CONFIRMED` | User-corroborated ground report |
| Reported | `Reported` | Single source, unconfirmed |

### Examples — write like this

> AS350 · N318LA · LASD Air-18
> alt 1,250ft ↓ · spd 78kts · hdg 085°
> tracked 14m · 3.2nm NE

> Hidden unit · Reported 8m ago
> 4 confirmations · last 47s
> 1.4mi SW of you · bearing 215°

> Last update 14:32:08 · 12 aircraft · 47 ground

### Avoid

- Marketing voice ("Stay safe out there!", "Awesome!", "Got it!")
- Cute empty states ("Nothing to see here", "All quiet")
- Smiley/face/sparkle iconography
- Apology phrasing ("Sorry, we couldn't…") — just state the condition
- "Premium" anything — tier names are Observer / Operator / Command

---

## VISUAL FOUNDATIONS

### Color philosophy

A near-black cool neutral base with three semantic accents:
- **Signal Blue (`#4D7CFF`)** — UI chrome, interactive elements, the "now" indicator, user position.
- **Aviation Amber (`#FFB020`)** — reserved exclusively for active aircraft. Nothing else. The eye should track aircraft activity without reading.
- **Threat Red (`#FF4757`)** — confirmed ground threats only. Used sparingly; reserved for severity.

Stale or historical data desaturates to mid-grey. Avoid traffic-light red/amber/green for non-severity states.

### Surfaces (dark theme)

```
ink-0   #0A0B0D   page base
ink-1   #14161A   primary surface (sheets, panels)
ink-2   #1C1F24   raised surface (cards within panels)
ink-3   #262A31   elevated chrome (controls, headers)
```

Surfaces are distinguishable in low light without relying on borders. Borders exist (`#2A2F37` at 1px) but are a tertiary cue.

### Typography

- **UI:** Aktiv Grotesk (self-hosted OTF, Thin → Black across 9 weights + italics).
- **Numerics & identifiers:** JetBrains Mono, `font-variant-numeric: tabular-nums` enabled globally on numeric content.
- **No serif. No display font.** A precise geometric sans plus a code-grade monospace; that is the whole system.

Sizes use a clean step: 11 / 12 / 13 / 14 / 16 / 18 / 24 / 32. Line-height tight (1.2–1.4) — this is a console, not a magazine.

### Spacing

A 4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 64. Dense by default.

### Radii

- `--r-sm 4px` — chips, inputs
- `--r-md 8px` — cards, sheet headers
- `--r-lg 12px` — bottom sheets, primary modals
- `--r-full 9999px` — pills, status capsules

Nothing more rounded than 12px on rectangular containers. Pills and capsules use full-round.

### Backgrounds

Flat. No gradients except for two specific cases:
1. **Map-surface gradient** to hint terrain elevation (subtle hypsometric tint).
2. **Bottom-sheet scrim** — a single linear gradient from transparent to `ink-0` so map data underneath the sheet fades cleanly.

No textures, no patterns, no full-bleed photography in chrome. Real photography may appear *inside* the map (satellite tiles) but never as decoration.

### Imagery vibe

Cool, low-saturation, near-monochrome. Anywhere a thumbnail or avatar appears (e.g. aircraft type illustrations), it's a vector silhouette in `--fg-3`, never a photo.

### Borders

`1px solid var(--border)` where needed. Never a colored border accent. Never a left-border-only "stripe" pattern.

### Shadows

Used minimally. The bottom sheet has a single soft top-shadow to lift it off the map. Floating action clusters use a tight drop shadow. No glow effects.

```
--shadow-sheet:  0 -8px 24px -4px rgba(0,0,0,0.5)
--shadow-fab:    0 4px 12px -2px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.4)
--shadow-panel:  0 8px 32px -8px rgba(0,0,0,0.7)
```

### Motion

- **Spring physics on transitions.** Default: stiffness 260, damping 28. Snappy but not jittery.
- **No linear easing anywhere.** Standard ease: `cubic-bezier(0.32, 0.72, 0, 1)` — a slight overshoot-free spring approximation.
- **Map camera moves with momentum.** Focus changes are considered, not instant.
- **Aircraft positions interpolate** smoothly between data updates. Never teleport.
- **New reports arrive with a calibrated pulse** — a single 600ms ring scale + fade. Not a bounce.
- **Transition durations:** 150ms (hover/press), 240ms (panel slide), 400ms (camera focus), 600ms (pulse), 1200ms (scrubber spring-to-now).

### Hover / press

This is a touch-first product, but desktop and tablet matter.

- **Hover:** background lightens by ~6% luminance (`ink-2` → `ink-3`). No color shift. No size change.
- **Press / active:** background darkens by ~4% and scales to 0.98 with the spring. Held state holds the scale.
- **Focus (keyboard):** 2px Signal Blue outline at 2px offset. No glow.

### Transparency & blur

Used in two places only:
1. **Top status strip** — `backdrop-filter: blur(20px)` on a `ink-1 @ 80%` background. Lets the map breathe through.
2. **Bottom sheet** — same treatment when collapsed; opaque when expanded past 50%.

Glass elsewhere is forbidden.

### Cards

- Background `--ink-2`
- Border `1px solid var(--border)`
- Radius `--r-md`
- Padding `12px 14px`
- No shadow

A card containing live data carries a `LIVE` chip (mono, 10px, `--blue` text on `--blue/10%` ground).

### Layout rules

- **Top status strip** fixed, 44px tall, blurs over map.
- **Bottom sheet** snap points at 88px (peek), 50%, 90%.
- **Floating action cluster** bottom-right, 16px from edge, 16px above the sheet's peek.
- **Time scrubber** is its own surface, 56px tall, sits *above* the bottom sheet when expanded — it's never occluded.
- **Map fills everything else.** Edge-to-edge. The map is the product.

---

## ICONOGRAPHY

VP-Overwatch uses **Lucide** as its base icon set, served from CDN. Lucide is chosen because:

- Consistent 1.5px stroke at 24px, scales cleanly to 16px and 20px.
- Outline-only (no fills) — matches the operator-console restraint.
- Open license, no attribution required, zero brand drift.

**Stroke weight:** 1.75 by default (slightly heavier than Lucide's 2px default for better optical balance against monospace numbers at small sizes). Override via `stroke-width="1.75"`.

**Sizes:** 16px (inline / tabular), 20px (default UI), 24px (primary actions), 32px (rare; only large status icons).

**Color:** icons inherit `currentColor`. Default: `--fg-2`. Interactive: `--fg-1`. Active/selected: `--blue`.

**Map glyphs are NOT Lucide.** Aircraft and ground-report markers are custom SVGs purpose-built for this product (see `assets/markers/`). Lucide is for chrome only.

**Emoji:** Never used in UI. Period.

**Unicode glyphs:** Used sparingly for typographic marks only — bullets (`·`), em-dashes (`—`), trend arrows (`↑↓→`), and the degree symbol (`°`). Never as icons.

**Logo:** A monogram mark (`VP-O` in a tight monospace) and a wordmark (`VP-OVERWATCH` letter-spaced). Both ship as inline SVGs in `assets/logo/`. The mark is the favicon and app icon; the wordmark appears once, top-left of the status strip in detail views.

---

## Tier names (when premium is built)

The product uses three tier names — **Observer**, **Operator**, **Command**. Free / Pro / Premium language is forbidden. Tiers map to operator competency, not features.

---

## What's NOT in v1 of this design system

By explicit user direction, the following are deferred:
- Onboarding flow
- Settings screen
- Premium upsell
- Auth screens

These are templated work. Effort goes into the map and its hero interactions instead.
