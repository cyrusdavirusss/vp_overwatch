#!/usr/bin/env python3
"""
VP-Overwatch fuel-ratio flight collector.

Continuously watches the VicPol Air Wing aircraft on the ADSB.lol feed and, the
moment one takes off, records a fine-grained telemetry sample-track for that
flight — exactly the FlightSample stream (tSec, altFt, gsKt, trackDeg, vsFpm)
that lib/fuel-model.ts integrates. On landing it writes one completed flight
record. It keeps collecting until it has TARGET_FLIGHTS completed flights per
aircraft, so we can run the fuel-burn model over real tracks and calibrate the
fuel ratio.

Design
  • Adaptive cadence: scans every IDLE_POLL_SEC when nothing is up; drops to
    FAST_POLL_SEC while any tracked aircraft is airborne (fuel modelling needs
    dense samples, not the 15-min presence cron).
  • Per-aircraft takeoff/landing state machine using the SAME thresholds as
    lib/adsb/config.ts (airborne 400 ft / 40 kt, ground 150 ft / 20 kt,
    2-observation confirmation).
  • Crash-safe: in-progress samples are appended to _active_<HEX>.jsonl and
    promoted to <HEX>.jsonl on landing, so a restart resumes an open flight.
  • Signal loss while airborne for LOST_TIMEOUT_SEC closes the flight
    (landed-or-stealth) rather than losing it.

Output (data/fuel-flights/)
  <HEX>.jsonl        one JSON object per completed flight: {meta, summary, samples[]}
  _active_<HEX>.jsonl in-progress sample buffer for the open flight (if any)
  collector-state.json  per-aircraft phase + completed-flight counts

Run:  python3 fuel-collector.py                 (foreground / systemd)
      python3 fuel-collector.py --once          (single poll, for testing/cron)
      python3 fuel-collector.py --target 20 --radius 250
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), 'data', 'fuel-flights')
STATE_FILE = os.path.join(DATA_DIR, 'collector-state.json')

# ── roster: the VicPol Air Wing fleet — three rotary, one fixed wing ────────
# Add a hex here and it is collected, scored and graphed like the rest. The
# King Air is fixed wing: it flies faster, higher and further than the AW139s,
# but the airborne/ground gates below are shared with lib/adsb/config.ts and
# hold for it, and the scorer picks its profile up from PERF_BY_HEX.
ROSTER = {
    '7c4ef2': {'callsign': 'POL30', 'registration': 'VH-PVO', 'type': 'AW139', 'role': 'rotary'},
    '7c4ef4': {'callsign': 'POL31', 'registration': 'VH-PVQ', 'type': 'AW139', 'role': 'rotary'},
    '7c4ef5': {'callsign': 'POL32', 'registration': 'VH-PVR', 'type': 'AW139', 'role': 'rotary'},
    '7c4ee8': {'callsign': 'POL35', 'registration': 'VH-PVE', 'type': 'King Air 350ER', 'role': 'fixedwing'},
}

# ── feed ────────────────────────────────────────────────────────────────────
CENTER_LAT, CENTER_LON = -37.81, 144.96          # Melbourne
ADSB_URL = 'https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}'
HTTP_TIMEOUT = 20

# ── takeoff/landing thresholds (mirror lib/adsb/config.ts movementConfig) ───
AIRBORNE_ALT_FT = 400
GROUND_ALT_FT = 150
AIRBORNE_SPEED_KT = 40
GROUND_SPEED_KT = 20
CONFIRM_OBS = 2

# ── cadence / collection ────────────────────────────────────────────────────
IDLE_POLL_SEC = 60
FAST_POLL_SEC = 15
LOST_TIMEOUT_SEC = 180          # airborne + no update this long ⇒ close flight
TARGET_FLIGHTS = 20             # per aircraft

from urllib.request import urlopen, Request

_STOP = False


def _sigterm(*_):
    global _STOP
    _STOP = True


def log(msg: str):
    print(f'{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%SZ} {msg}', flush=True)


def haversine_km(a, b):
    R = 6371.0
    dlat = math.radians(b[0] - a[0]); dlon = math.radians(b[1] - a[1])
    h = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def fetch(radius: int) -> list[dict]:
    url = ADSB_URL.format(lat=CENTER_LAT, lon=CENTER_LON, radius=radius)
    req = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'vp-overwatch-fuel-collector'})
    with urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode()).get('ac', [])


def alt_ft(ac: dict):
    v = ac.get('alt_baro')
    if v == 'ground':
        return 0
    if isinstance(v, (int, float)):
        return float(v)
    v = ac.get('alt_geom')
    return float(v) if isinstance(v, (int, float)) else None


def sample_from(ac: dict, now_ms: int) -> dict:
    """Build a fuel-model FlightSample (+ lat/lon) from an ADSB.lol record."""
    vs = ac.get('baro_rate')
    if not isinstance(vs, (int, float)):
        vs = ac.get('geom_rate') if isinstance(ac.get('geom_rate'), (int, float)) else 0
    return {
        'ts': now_ms,
        'altFt': alt_ft(ac),
        'gsKt': float(ac.get('gs')) if isinstance(ac.get('gs'), (int, float)) else None,
        'trackDeg': float(ac.get('track')) if isinstance(ac.get('track'), (int, float)) else None,
        'vsFpm': float(vs),
        'lat': ac.get('lat'),
        'lon': ac.get('lon'),
        'seen_pos': ac.get('seen_pos'),
    }


def is_airlike(s: dict) -> bool:
    a = s['altFt']; g = s['gsKt']
    return (a is not None and a >= AIRBORNE_ALT_FT) or (g is not None and g >= AIRBORNE_SPEED_KT)


def is_groundlike(s: dict) -> bool:
    a = s['altFt']; g = s['gsKt']
    return (a is None or a <= GROUND_ALT_FT) and (g is None or g <= GROUND_SPEED_KT)


# ── state ───────────────────────────────────────────────────────────────────
def load_state() -> dict:
    """State for every aircraft in ROSTER, including any added since the last run.

    The saved file is MERGED, never trusted wholesale: the state dict is keyed by
    hex, so a hex added to ROSTER was previously missing here, and the first
    `state[hex]['phase']` access then raised KeyError and crash-looped the service
    (it runs under Restart=always).
    """
    state = {}
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
        except (OSError, ValueError) as e:
            log(f'state file unreadable ({e}) — starting fresh')
            state = {}
    for h in ROSTER:
        state.setdefault(h, {'phase': 'ground', 'air_streak': 0, 'gnd_streak': 0,
                             'completed': 0, 'open': False, 'start_ms': None, 'last_ms': None})
    return state


def save_state(state: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


def active_path(hexid): return os.path.join(DATA_DIR, f'_active_{hexid}.jsonl')
def flights_path(hexid): return os.path.join(DATA_DIR, f'{hexid}.jsonl')

_SCORER = os.path.join(SCRIPT_DIR, 'fuel-score.ts')
_NODE = shutil.which('node') or '/usr/bin/node'


def score_async(hexid: str):
    """Fire-and-forget: run the TS fuel-model scorer over this aircraft's
    flights so the just-landed flight gets a fuel-ratio score. Never blocks or
    breaks collection if node/scorer is unavailable."""
    try:
        subprocess.Popen(
            [_NODE, '--experimental-strip-types', _SCORER, '--hex', hexid],
            cwd=os.path.dirname(SCRIPT_DIR),
            stdout=sys.stdout, stderr=subprocess.STDOUT,
        )
    except Exception as e:
        log(f'SCORE_SPAWN_ERROR {hexid} {e}')


def append_active(hexid, sample):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(active_path(hexid), 'a') as f:
        f.write(json.dumps(sample) + '\n')


def open_flight(state, hexid, sample, now_ms):
    st = state[hexid]
    st['open'] = True
    st['start_ms'] = now_ms
    st['last_ms'] = now_ms
    # fresh active buffer
    try:
        os.remove(active_path(hexid))
    except FileNotFoundError:
        pass
    append_active(hexid, sample)
    log(f'TAKEOFF {ROSTER[hexid]["callsign"]} ({hexid}) alt={sample["altFt"]}ft gs={sample["gsKt"]}kt '
        f'[{st["completed"]}/{TARGET_FLIGHTS} done]')


def close_flight(state, hexid, reason: str):
    st = state[hexid]
    if not st.get('open'):
        return
    ap = active_path(hexid)
    samples = []
    if os.path.exists(ap):
        with open(ap) as f:
            samples = [json.loads(l) for l in f if l.strip()]
    if len(samples) < 2:
        log(f'DISCARD {ROSTER[hexid]["callsign"]} ({hexid}) too few samples ({len(samples)}) [{reason}]')
    else:
        t0 = samples[0]['ts']
        for s in samples:
            s['tSec'] = round((s['ts'] - t0) / 1000, 1)
        dur_s = (samples[-1]['ts'] - t0) / 1000
        # path distance from consecutive positions
        pts = [(s['lat'], s['lon']) for s in samples if s['lat'] is not None and s['lon'] is not None]
        path_km = sum(haversine_km(pts[i - 1], pts[i]) for i in range(1, len(pts)))
        alts = [s['altFt'] for s in samples if s['altFt'] is not None]
        gss = [s['gsKt'] for s in samples if s['gsKt'] is not None]
        rec = {
            'meta': dict(ROSTER[hexid], hex=hexid),
            'summary': {
                'start_iso': datetime.fromtimestamp(t0 / 1000, timezone.utc).isoformat(),
                'end_iso': datetime.fromtimestamp(samples[-1]['ts'] / 1000, timezone.utc).isoformat(),
                'duration_min': round(dur_s / 60, 2),
                'samples': len(samples),
                'path_km': round(path_km, 2),
                'peak_alt_ft': max(alts) if alts else None,
                'max_gs_kt': max(gss) if gss else None,
                'avg_sample_gap_s': round(dur_s / max(1, len(samples) - 1), 1),
                'close_reason': reason,
            },
            'samples': samples,
        }
        with open(flights_path(hexid), 'a') as f:
            f.write(json.dumps(rec) + '\n')
        st['completed'] += 1
        s = rec['summary']
        log(f'LANDING {ROSTER[hexid]["callsign"]} ({hexid}) {s["duration_min"]}min '
            f'{s["path_km"]}km peak={s["peak_alt_ft"]}ft samples={s["samples"]} '
            f'[{reason}] -> {st["completed"]}/{TARGET_FLIGHTS}')
        score_async(hexid)   # auto-score the just-landed flight with the fuel model
        if st['completed'] >= TARGET_FLIGHTS:
            log(f'TARGET_REACHED {ROSTER[hexid]["callsign"]} ({hexid}) — {TARGET_FLIGHTS} flights collected')
    try:
        os.remove(ap)
    except FileNotFoundError:
        pass
    st['open'] = False
    st['start_ms'] = st['last_ms'] = None


def poll_once(state, radius: int) -> bool:
    """One poll. Returns True if any tracked aircraft is currently airborne."""
    now_ms = int(time.time() * 1000)
    try:
        ac = fetch(radius)
    except Exception as e:
        log(f'FETCH_ERROR {e}')
        return any(state[h]['phase'] == 'airborne' for h in ROSTER)

    seen = {a.get('hex', '').lower(): a for a in ac if a.get('hex', '').lower() in ROSTER}
    any_air = False

    for hexid, meta in ROSTER.items():
        st = state[hexid]
        done = st['completed'] >= TARGET_FLIGHTS
        if hexid in seen:
            s = sample_from(seen[hexid], now_ms)
            air = is_airlike(s); gnd = is_groundlike(s)
            st['air_streak'] = st['air_streak'] + 1 if air else 0
            st['gnd_streak'] = st['gnd_streak'] + 1 if gnd else 0

            if st['phase'] == 'ground' and st['air_streak'] >= CONFIRM_OBS:
                st['phase'] = 'airborne'
                if not done:
                    open_flight(state, hexid, s, now_ms)
                else:
                    log(f'AIRBORNE {meta["callsign"]} (target already reached — not recording)')
            elif st['phase'] == 'airborne' and st['gnd_streak'] >= CONFIRM_OBS:
                st['phase'] = 'ground'
                close_flight(state, hexid, 'landed')

            if st['phase'] == 'airborne':
                any_air = True
                st['last_ms'] = now_ms
                if st.get('open'):
                    append_active(hexid, s)
        else:
            # not in feed this tick
            if st['phase'] == 'airborne':
                if st.get('last_ms') and now_ms - st['last_ms'] > LOST_TIMEOUT_SEC * 1000:
                    st['phase'] = 'ground'
                    st['air_streak'] = st['gnd_streak'] = 0
                    close_flight(state, hexid, 'signal-lost')
                else:
                    any_air = True   # keep fast cadence during a brief dropout

    save_state(state)
    return any_air


def main() -> int:
    global TARGET_FLIGHTS
    ap = argparse.ArgumentParser(description='VP-Overwatch fuel-ratio flight collector')
    ap.add_argument('--once', action='store_true', help='single poll then exit')
    ap.add_argument('--target', type=int, default=TARGET_FLIGHTS)
    ap.add_argument('--radius', type=int, default=250, help='feed radius (nm)')
    args = ap.parse_args()

    TARGET_FLIGHTS = args.target

    signal.signal(signal.SIGTERM, _sigterm)
    signal.signal(signal.SIGINT, _sigterm)
    os.makedirs(DATA_DIR, exist_ok=True)
    state = load_state()
    # ensure roster keys exist even if state predates a roster change
    for h in ROSTER:
        state.setdefault(h, {'phase': 'ground', 'air_streak': 0, 'gnd_streak': 0,
                             'completed': 0, 'open': False, 'start_ms': None, 'last_ms': None})

    done_all = all(state[h]['completed'] >= TARGET_FLIGHTS for h in ROSTER)
    completed_str = ', '.join(f"{ROSTER[h]['callsign']}={state[h]['completed']}" for h in ROSTER)
    log(f'collector up — roster={[m["callsign"] for m in ROSTER.values()]} '
        f'target={TARGET_FLIGHTS} radius={args.radius}nm  completed=[{completed_str}]')

    if args.once:
        poll_once(state, args.radius)
        return 0

    while not _STOP:
        any_air = poll_once(state, args.radius)
        if all(state[h]['completed'] >= TARGET_FLIGHTS for h in ROSTER):
            if not done_all:
                log('ALL_TARGETS_REACHED — collection complete for every aircraft; idling')
                done_all = True
            delay = IDLE_POLL_SEC * 5
        else:
            done_all = False
            delay = FAST_POLL_SEC if any_air else IDLE_POLL_SEC
        # interruptible sleep
        for _ in range(delay):
            if _STOP:
                break
            time.sleep(1)

    log('collector stopping (signal) — flushing state')
    save_state(state)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
