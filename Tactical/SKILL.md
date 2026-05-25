---
name: vp-overwatch-design
description: Use this skill to generate well-branded interfaces and assets for VP-Overwatch — a mobile situational-awareness app that fuses ADS-B law-enforcement aircraft tracking with Waze ground-report data on a custom map. Contains essential design guidelines, color & type tokens, custom map markers, app logos, and a working UI kit prototype (mobile map view with live aircraft, ground reports, and the signature time-scrubber interaction).
user-invocable: true
---

# VP-Overwatch design skill

Read `README.md` first for the full product context, content fundamentals, visual foundations, and iconography rules. Then explore:

| File | What it gives you |
|---|---|
| `colors_and_type.css` | All design tokens (color, type, spacing, radii, shadow, motion) for dark + light themes. Import this in any new HTML you create. |
| `preview/` | Small HTML cards showing every token in use. Useful reference. |
| `assets/logo/` | `mark.svg`, `wordmark.svg` — copy out when you need brand. |
| `assets/markers/` | Custom SVG map markers — rotary, fixedwing, marked, unmarked, hidden, stop, checkpoint. Use these on maps, not Lucide. |
| `assets/relay/` | The Waze relay code (reference for data shape: `uuid`, `alerts` array, 30-min TTL, 60s poll cadence). |
| `ui_kits/app/` | Full React prototype of the main app — open `index.html`. Map renderer, time scrubber, aircraft + report detail panels, filter panel. Copy components out as needed. |

## When invoked

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view. Always link `colors_and_type.css` so tokens stay consistent.

If working on production code, copy the tokens and read the rules in `README.md` to become an expert in designing with this brand.

If the user invokes this skill without other guidance, ask them what they want to build, ask a few focused questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Hard rules (do not break)

- **Aviation amber `#FFB020` is reserved for active aircraft.** Nothing else.
- **Threat red `#FF4757` is for confirmed ground threats.** Used sparingly.
- **Signal blue `#4D7CFF` carries UI chrome, live indicators, user position.** Default interactive color.
- **All numerics in JetBrains Mono with tabular-nums.** Even in body copy.
- **No emoji in UI. No gradients except map terrain and the sheet scrim. No glassmorphism outside the status strip and bottom sheet.**
- **The map is the product** — when designing new screens, map-first; chrome around it should never compete.

## What's not in v1 (don't fabricate)

Onboarding, settings, premium upsell, and auth flows are explicitly deferred. Don't invent these unless the user asks.
