# VicPol Aircraft History Tracker

A standalone, stdlib-only Python daemon that tracks Melbourne VicPol/AFP
aircraft via [ADSB.lol](https://api.adsb.lol). It records every sighting to
`data/history.jsonl` and maintains per-aircraft sortie state in
`data/sorties.json`.

## Files

| File | Purpose |
|------|---------|
| `scripts/vicpol-tracker.py` | The daemon (polling, sortie tracking, history). |
| `~/.hermes/scripts/vicpol-tracker.sh` | Launcher for cron/startup (PID-guarded). |
| `run.sh` (repo root) | Convenience wrapper that starts the daemon in the background. |

## Data files (in `data/`)

- `history.jsonl` — one JSON object per sighting, appended (never truncated).
- `sorties.json`  — current per-hex sortie state, keyed by hex (loaded on start, never overwritten on boot).
- `last_check.json` — heartbeat (`lastCheck` epoch ms, `aircraftSeen`). `aircraftSeen: -1` means the last fetch failed.
- `tracker.pid` — PID of the running daemon.
- `tracker.log` — stdout/stderr when launched via the launcher.

## Usage

```bash
# Single poll, then exit (ideal for cron):
python3 scripts/vicpol-tracker.py --once --verbose

# Foreground loop, default 120s interval:
python3 scripts/vicpol-tracker.py

# Custom interval (seconds):
python3 scripts/vicpol-tracker.py --interval 60

# Background daemon (double-fork, detaches from terminal):
python3 scripts/vicpol-tracker.py --daemon

# Or use the PID-guarded launcher / repo-root wrapper:
./run.sh
~/.hermes/scripts/vicpol-tracker.sh
```

### CLI flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--interval SECONDS` | `120` | Poll interval. |
| `--daemon` | off | Fork to background and detach. |
| `--once` | off | Single poll and exit. |
| `--verbose` | off | Detailed per-tick logging. |

## Cron example

Run every 2 minutes; the launcher no-ops if already running:

```cron
*/2 * * * * /home/cyrus/.hermes/scripts/vicpol-tracker.sh
```

Or as a one-shot poll per tick (no resident daemon):

```cron
*/2 * * * * cd /home/cyrus/Documents/vp_overwatch/Tactical && python3 scripts/vicpol-tracker.py --once >> data/tracker.log 2>&1
```

## Behaviour notes

- **Filtering:** only hexes in `KNOWN_AIRCRAFT` are recorded (POL31/32/61/64/67, AFP21).
- **Sorties:** a sortie starts on first sighting; it ends after **15 min** of
  no sightings. Seeing the aircraft again after it ended starts a fresh sortie.
- **Units:** altitude in feet, ground speed in knots, vertical rate in ft/min,
  distance in km. Source values from ADSB.lol are converted from metric.
- **Resilience:** network errors are logged and skipped; HTTP 429 triggers
  exponential backoff (60s → max 600s). The daemon never crashes on a bad tick.
- **Shutdown:** SIGTERM/SIGINT finish the current tick, write a final heartbeat,
  remove the PID file, and exit clean.

## Sample output

```
[14:30:00] SORTIE_START POL31 — now=04:30:00 UTC
[14:30:00] SEEN POL31/VH-PVQ @ 7300ft 45kt hdg=328 vr=+1258fpm — 0m flown, 0.0km
[14:32:00] HEARTBEAT — tracker running, 1 VicPol seen
[15:15:00] SORTIE_END POL32 — flew 45m, 64.2km, peak 9843ft, ended 05:15:00 UTC
[15:17:00] GONE — no known VicPol aircraft this tick
[15:19:00] ERROR — failed to fetch: HTTP 429 rate limited (backoff 120s)
```
