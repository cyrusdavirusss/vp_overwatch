#!/usr/bin/env python3
"""
VicPol/AFP aircraft history recorder — standalone daemon.

Polls ADSB.lol for known Melbourne VicPol/AFP hex codes, appends sightings to
history.jsonl, maintains per-aircraft sortie state in sorties.json, and writes a
heartbeat so other tools know the tracker is alive.

Picks up from existing data:
  - Loads existing sorties.json on startup (never truncates it).
  - Appends to existing history.jsonl (never truncates it).
  - Creates an empty sorties.json on first run.

Run modes:
  python3 vicpol-tracker.py --once --verbose   # single poll, for cron
  python3 vicpol-tracker.py                     # foreground loop (120s)
  python3 vicpol-tracker.py --daemon            # fork to background
  python3 vicpol-tracker.py --interval 60       # custom poll interval

Stdlib only — no pip installs.
"""

import argparse
import json
import math
import os
import signal
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import urlopen, Request

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR = '/home/cyrus/Documents/vp_overwatch/Tactical/data'
HISTORY_FILE = os.path.join(DATA_DIR, 'history.jsonl')
SORTIES_FILE = os.path.join(DATA_DIR, 'sorties.json')
HEARTBEAT_FILE = os.path.join(DATA_DIR, 'last_check.json')
PID_FILE = os.path.join(DATA_DIR, 'tracker.pid')

# ── Known VicPol/AFP aircraft (hex -> metadata) ─────────────────────────────────
KNOWN_AIRCRAFT = {
    '7C4EF2': {'callsign': 'POL30', 'registration': 'VH-PVO', 'type': 'AW139', 'role': 'rotary'},
    '7C4EF4': {'callsign': 'POL31', 'registration': 'VH-PVQ', 'type': 'AW139', 'role': 'rotary'},
    '7C4EF5': {'callsign': 'POL32', 'registration': 'VH-PVR', 'type': 'AW139', 'role': 'rotary'},
    '7C4EE8': {'callsign': 'POL35', 'registration': 'VH-PVE', 'type': 'B350', 'role': 'fixed'},
}

# ── Polling config ──────────────────────────────────────────────────────────────
DEFAULT_LAT = -37.81
DEFAULT_LON = 144.96
RADIUS_KM = 100
TIMEOUT_SEC = 20
ADSB_URL = f'https://api.adsb.lol/v2/point/{DEFAULT_LAT}/{DEFAULT_LON}/{RADIUS_KM}'
HEX_URL = 'https://api.adsb.lol/v2/hex/{}'

SORTIE_TIMEOUT_SEC = 900       # 15 min absence ends a sortie
BACKOFF_START_SEC = 60
BACKOFF_MAX_SEC = 600

# ── Conversion factors (adsb.lol gives metric) ──────────────────────────────────
M_TO_FEET = 3.28084
MS_TO_KNOTS = 1.94384
MS_TO_FPM = 196.85

_running = True   # flipped by signal handler to stop the loop


# ── Logging ──────────────────────────────────────────────────────────────────
def log(msg: str):
    """Print one timestamped line to stdout."""
    stamp = datetime.now().strftime('%H:%M:%S')
    print(f'[{stamp}] {msg}', flush=True)


def utc_clock() -> str:
    return datetime.now(timezone.utc).strftime('%H:%M:%S UTC')


# ── State I/O ──────────────────────────────────────────────────────────────────
def load_sorties() -> dict:
    """Load existing sortie state, or {} if none yet. Never raises on bad file."""
    if os.path.exists(SORTIES_FILE):
        try:
            with open(SORTIES_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log(f'WARN — sorties.json unreadable ({e}); starting fresh state')
            return {}
    return {}


def save_sorties(sorties: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = SORTIES_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(sorties, f, indent=2)
    os.replace(tmp, SORTIES_FILE)   # atomic — never leaves a half-written file


def append_history(entry: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HISTORY_FILE, 'a') as f:
        f.write(json.dumps(entry) + '\n')


def save_heartbeat(ts: int, seen_count: int):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HEARTBEAT_FILE, 'w') as f:
        json.dump({'lastCheck': ts, 'aircraftSeen': seen_count}, f)


# ── Geo ─────────────────────────────────────────────────────────────────────
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in km."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Fetch ──────────────────────────────────────────────────────────────────────
class RateLimited(Exception):
    """Raised on HTTP 429 so the loop can back off."""


def fetch_adsb() -> list[dict]:
    """Fetch aircraft list from ADSB.lol. Raises RateLimited on 429."""
    req = Request(ADSB_URL, headers={'Accept': 'application/json',
                                     'User-Agent': 'vicpol-tracker/1.0'})
    try:
        with urlopen(req, timeout=TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode())
    except HTTPError as e:
        if e.code == 429:
            raise RateLimited('HTTP 429 rate limited')
        raise
    return data.get('ac', []) or []


def fetch_hex(hex_code: str) -> dict | None:
    """Directly query a single hex. Returns the aircraft dict or None."""
    req = Request(HEX_URL.format(hex_code.lower()),
                  headers={'Accept': 'application/json',
                           'User-Agent': 'vicpol-tracker/1.0'})
    try:
        with urlopen(req, timeout=TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode())
            ac = data.get('ac', [])
            return ac[0] if ac else None
    except (HTTPError, URLError, OSError, ValueError):
        return None


# ── Core tick ──────────────────────────────────────────────────────────────────
def process_tick(verbose: bool = False):
    """Run one poll: fetch, filter, append history, update sorties, heartbeat.

    Returns the number of known aircraft seen this tick.
    Raises RateLimited / URLError / HTTPError on fetch failure (caller handles).
    """
    now_ts = int(time.time() * 1000)
    now_utc = utc_clock()

    aircraft = fetch_adsb()
    if verbose:
        log(f'fetched {len(aircraft)} aircraft in {RADIUS_KM}nm of Melbourne')

    sorties = load_sorties()
    mutated = False
    found = set()

    for ac in aircraft:
        hex_code = (ac.get('hex') or '').upper()
        if hex_code not in KNOWN_AIRCRAFT:
            continue

        lat = ac.get('lat')
        lon = ac.get('lon')
        if lat is None or lon is None:
            if verbose:
                log(f'skip {hex_code} — no position yet')
            continue

        found.add(hex_code)
        known = KNOWN_AIRCRAFT[hex_code]

        callsign = (ac.get('flight') or '').strip() or known['callsign']
        alt_raw = float(ac.get('alt_geom', 0) or 0)
        if alt_raw <= 0:
            alt_raw = float(ac.get('alt_baro', 0) or 0)
        alt = round(alt_raw * M_TO_FEET)
        gs = round(float(ac.get('gs', 0) or 0) * MS_TO_KNOTS)
        heading = round(float(ac.get('track', 0) or 0))
        registration = ac.get('r') or known['registration']
        vr = round(float(ac.get('baro_rate', 0) or 0) * MS_TO_FPM)

        append_history({
            'ts': now_ts,
            'hex': hex_code,
            'callsign': callsign,
            'lat': lat,
            'lon': lon,
            'alt': alt,
            'gs': gs,
            'heading': heading,
            'vr': vr,
            'registration': registration,
            'type': known['type'],
            'source': 'adsb.lol',
        })

        existing = sorties.get(hex_code)
        if existing is None or existing.get('status') == 'ended':
            # Brand new, or seen again after the sortie ended -> fresh sortie.
            sorties[hex_code] = {
                'callsign': callsign,
                'registration': registration,
                'type': known['type'],
                'role': known['role'],
                'startTime': now_ts,
                'lastSeen': now_ts,
                'firstLat': lat,
                'firstLon': lon,
                'latestLat': lat,
                'latestLon': lon,
                'peakAlt': alt,
                'distKm': 0.0,
                'lastLat': lat,
                'lastLon': lon,
                'status': 'active',
            }
            log(f'SORTIE_START {callsign} — now={now_utc}')
        else:
            s = existing
            last_lat = s.get('lastLat', s.get('latestLat', lat))
            last_lon = s.get('lastLon', s.get('latestLon', lon))
            s['distKm'] = round(s.get('distKm', 0.0) + haversine_km(last_lat, last_lon, lat, lon), 2)
            s['lastSeen'] = now_ts
            s['lastLat'] = lat
            s['lastLon'] = lon
            s['latestLat'] = lat
            s['latestLon'] = lon
            s['callsign'] = callsign
            s['registration'] = registration
            if alt > s.get('peakAlt', 0):
                s['peakAlt'] = alt
            s.pop('endTime', None)   # was ended, now active again
        mutated = True

        s = sorties[hex_code]
        dur_min = round((now_ts - s['startTime']) / 60000)
        log(f'SEEN {callsign}/{registration} @ {alt}ft {gs}kt hdg={heading} '
            f'vr={vr:+d}fpm — {dur_min}m flown, {s["distKm"]}km')

    # ── Secondary pass: hex API lookup for known hexes missed by point query ──
    for hex_code, known in KNOWN_AIRCRAFT.items():
        if hex_code in found:
            continue
        ac = fetch_hex(hex_code)
        if ac is None:
            continue

        found.add(hex_code)
        callsign = (ac.get('flight') or '').strip() or known['callsign']
        alt_raw = float(ac.get('alt_geom', 0) or 0)
        if alt_raw <= 0:
            alt_raw = float(ac.get('alt_baro', 0) or 0)
        alt = round(alt_raw * M_TO_FEET)
        gs = round(float(ac.get('gs', 0) or 0) * MS_TO_KNOTS)
        heading = round(float(ac.get('track', 0) or 0))
        registration = ac.get('r') or known['registration']
        vr = round(float(ac.get('baro_rate', 0) or 0) * MS_TO_FPM)

        append_history({
            'ts': now_ts,
            'hex': hex_code,
            'callsign': callsign,
            'lat': None,
            'lon': None,
            'alt': alt,
            'gs': gs,
            'heading': heading,
            'vr': vr,
            'registration': registration,
            'type': known['type'],
            'source': 'adsb.lol',
        })

        existing = sorties.get(hex_code)
        if existing is None or existing.get('status') == 'ended':
            sorties[hex_code] = {
                'callsign': callsign,
                'registration': registration,
                'type': known['type'],
                'role': known['role'],
                'startTime': now_ts,
                'lastSeen': now_ts,
                'firstLat': None,
                'firstLon': None,
                'latestLat': None,
                'latestLon': None,
                'peakAlt': alt,
                'distKm': 0.0,
                'lastLat': None,
                'lastLon': None,
                'status': 'active',
            }
            log(f'SORTIE_START {callsign} (no_fix) — now={now_utc}')
        else:
            s = existing
            s['lastSeen'] = now_ts
            s['callsign'] = callsign
            s['registration'] = registration
            if alt > s.get('peakAlt', 0):
                s['peakAlt'] = alt
            s.pop('endTime', None)
            s['firstLat'] = s.get('firstLat')  # preserve None if never had one
        mutated = True

        s = sorties[hex_code]
        dur_min = round((now_ts - s['startTime']) / 60000)
        log(f'SEEN {callsign}/{registration} @ {alt}ft {gs}kt hdg={heading} '
            f'vr={vr:+d}fpm (no_fix) — {dur_min}m flown')

    # End sorties for aircraft absent > 15 minutes.
    for hex_code, s in sorties.items():
        if hex_code in found or s.get('status') != 'active':
            continue
        if (now_ts - s.get('lastSeen', now_ts)) / 1000 > SORTIE_TIMEOUT_SEC:
            s['status'] = 'ended'
            s['endTime'] = now_ts
            mutated = True
            dur_min = round((now_ts - s['startTime']) / 60000)
            log(f'SORTIE_END {s["callsign"]} — flew {dur_min}m, {s.get("distKm", 0)}km, '
                f'peak {s.get("peakAlt", 0)}ft, ended {now_utc}')

    if mutated:
        save_sorties(sorties)

    save_heartbeat(now_ts, len(found))

    if found:
        log(f'HEARTBEAT — tracker running, {len(found)} VicPol seen')
    else:
        log('GONE — no known VicPol aircraft this tick')

    return len(found)


# ── Daemon plumbing ──────────────────────────────────────────────────────────
def write_pid():
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))


def remove_pid():
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


def handle_signal(signum, frame):
    global _running
    _running = False
    log(f'SIGNAL {signal.Signals(signum).name} — shutting down after current tick')


def daemonize():
    """Standard double-fork to detach from the controlling terminal."""
    if os.fork() > 0:
        sys.exit(0)
    os.setsid()
    if os.fork() > 0:
        sys.exit(0)
    sys.stdout.flush()
    sys.stderr.flush()
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, sys.stdin.fileno())
    # stdout/stderr are left attached so the launcher can redirect to tracker.log.


def run_loop(interval: int, verbose: bool):
    write_pid()
    log(f'STARTUP — vicpol-tracker, interval={interval}s, pid={os.getpid()}')
    backoff = BACKOFF_START_SEC
    try:
        while _running:
            try:
                process_tick(verbose=verbose)
                backoff = BACKOFF_START_SEC   # reset after a clean tick
                wait = interval
            except RateLimited as e:
                log(f'ERROR — failed to fetch: {e} (backoff {backoff}s)')
                save_heartbeat(int(time.time() * 1000), -1)
                wait = backoff
                backoff = min(backoff * 2, BACKOFF_MAX_SEC)
            except (URLError, HTTPError, OSError, ValueError) as e:
                log(f'ERROR — failed to fetch: {e} (backoff {backoff}s)')
                save_heartbeat(int(time.time() * 1000), -1)
                wait = backoff
                backoff = min(backoff * 2, BACKOFF_MAX_SEC)

            # Sleep in 1s slices so signals stop us promptly.
            slept = 0
            while _running and slept < wait:
                time.sleep(1)
                slept += 1
    finally:
        save_heartbeat(int(time.time() * 1000), 0)
        log('SHUTDOWN — final heartbeat written, exiting clean')
        remove_pid()


# ── CLI ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='VicPol/AFP aircraft history recorder')
    parser.add_argument('--interval', type=int, default=120,
                        help='poll interval in seconds (default 120)')
    parser.add_argument('--daemon', action='store_true',
                        help='fork to background and detach from terminal')
    parser.add_argument('--once', action='store_true',
                        help='single poll and exit (for cron)')
    parser.add_argument('--verbose', action='store_true',
                        help='more detailed per-tick logging')
    args = parser.parse_args()

    if args.once:
        try:
            process_tick(verbose=args.verbose)
        except RateLimited as e:
            log(f'ERROR — failed to fetch: {e} (backoff n/a in --once)')
            save_heartbeat(int(time.time() * 1000), -1)
            sys.exit(1)
        except (URLError, HTTPError, OSError, ValueError) as e:
            log(f'ERROR — failed to fetch: {e} (backoff n/a in --once)')
            save_heartbeat(int(time.time() * 1000), -1)
            sys.exit(1)
        return

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    if args.daemon:
        daemonize()

    run_loop(args.interval, args.verbose)


if __name__ == '__main__':
    main()
