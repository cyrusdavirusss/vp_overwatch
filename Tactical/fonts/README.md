# Fonts

VP-Overwatch uses **Aktiv Grotesk** (UI) and **JetBrains Mono** (data + identifiers).

## Aktiv Grotesk

Self-hosted OTF files in this folder. Eight weights × two styles (Thin → Black, roman + italic). Mapped to standard CSS weight values 100–900 via `@font-face` in `colors_and_type.css`.

| File | CSS weight |
|---|---|
| `Aktiv_Grotesk_Thin.otf` | 100 |
| `Aktiv_Grotesk_Hair.otf` | 200 |
| `Aktiv_Grotesk_Light.otf` | 300 |
| `Aktiv_Grotesk_Regular.otf` | 400 |
| `Aktiv_Grotesk_Medium.otf` | 500 |
| `Aktiv_Grotesk_SemiBold.otf` | 600 |
| `Aktiv_Grotesk_Bold.otf` | 700 |
| `Aktiv_Grotesk_XBold.otf` | 800 |
| `Aktiv_Grotesk_Black.otf` | 900 |

Italic variants exist for every weight.

## JetBrains Mono

Loaded from Google Fonts via `@import`. Used for all numeric content, identifiers (registrations, ICAO hex, callsigns), and the small fixed-width metadata that runs through the app's data tables.

## Pairing rules

- UI body, headings, labels, button text → **Aktiv Grotesk**.
- Anything tabular or that should not reflow when a digit changes → **JetBrains Mono** with `font-variant-numeric: tabular-nums`.
- Never mix the two within a number-bearing line unless deliberately framing the number against narrative text.
