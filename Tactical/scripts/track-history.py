#!/usr/bin/env python3
"""
VP-Overwatch VicPol aircraft history tracker.

Runs every 15 minutes via cron. Polls ADSB.lol for known VicPol/AFP hex codes,
logs sightings to history.jsonl, and maintains a sorties.json state file so we
can answer "what was in the air in the last X hours" questions.

Outputs to stdout only when something interesting happens:
  - "SEEN <hex> <callsign> <alt>ft <gs>kt" (aircraft detected)
  - "LOST <hex> <callsign> <flight_time>m" (aircraft disappeared)
  - "GONE <n> known" (no known aircraft detected this tick)
  - "SORTIE_START <hex> <callsign>" (first detection after absence)
  - "SORTIE_END <hex> <callsign> <duration>m" (aircraft left tracking range)

LATEST POLL — If no aircraft detected, still writes a heartbeat marker so we
know the tracker was running and the feed was checked.
"""

import json
import math
import os
import time
from datetime import datetime, timezone
from urllib.request import urlopen, Request

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = '/home/cyrus/Documents/vp_overwatch/Tactical/data'
HISTORY_FILE = os.path.join(DATA_DIR, 'history.jsonl')
SORTIES_FILE = os.path.join(DATA_DIR, 'sorties.json')
HEARTBEAT_FILE = os.path.join(DATA_DIR, 'last_check.json')

# Known VicPol/AFP aircraft (hex -> metadata)
KNOWN_AIRCRAFT = {
    '7C7F8C': {'callsign': 'POL61', 'registration': 'VH-PVH', 'type': 'AW139', 'role': 'rotary'},
    '7C2B22': {'callsign': 'POL64', 'registration': 'VH-PVI', 'type': 'EC135', 'role': 'rotary'},
    '7C1F40': {'callsign': 'POL67', 'registration': 'VH-PVK', 'type': 'AW139', 'role': 'rotary'},
    '7C4EF4': {'callsign': 'POL31', 'registration': 'VH-PVQ', 'type': 'A139', 'role': 'rotary'},
    '7C4EF5': {'callsign': 'POL32', 'registration': 'VH-PVR', 'type': 'A139', 'role': 'rotary'},
    '7CF102': {'callsign': 'AFP21', 'registration': 'VH-AFC', 'type': 'C208', 'role': 'fixed'},
}

# Default Melbourne center point
DEFAULT_LAT = -37.81
DEFAULT_LNG = 144.96
RADIUS_KM = 100
TIMEOUT_SEC = 20

# ── Helpers ─────────────────────────────────────────────────────────────────
ADSB_BASE = 'https://api.adsb.lol/v2/point'

def fetch_adsb(lat: float, lng: float, radius: int) -> list[dict]:
    """Fetch aircraft from ADSB.lol. Returns list of aircraft dicts."""
    url = f'{ADSB_BASE}/{lat}/{lng}/{radius}'
    req = Request(url, headers={'Accept': 'application/json'})
    with urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = json.loads(resp.read().decode())
    return data.get('ac', [])


def load_sorties() -> dict:
    """Load current sortie state."""
    if os.path.exists(SORTIES_FILE):
        with open(SORTIES_FILE) as f:
            return json.load(f)
    return {}


def save_sorties(sorties: dict):
    """Save sortie state."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SORTIES_FILE, 'w') as f:
        json.dump(sorties, f, indent=2)


def append_history(entry: dict):
    """Append one line to JSONL history."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HISTORY_FILE, 'a') as f:
        f.write(json.dumps(entry) + '\n')


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in km (Haversine formula)."""
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def save_heartbeat(ts: int, seen_count: int):
    """Write latest check timestamp so other tools know we ran."""
    with open(HEARTBEAT_FILE, 'w') as f:
        json.dump({'lastCheck': ts, 'aircraftSeen': seen_count}, f)


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    now_ts = int(time.time() * 1000)
    now_dt = datetime.now(timezone.utc).strftime('%H:%M:%S UTC')

    # Fetch raw ADS-B data
    try:
        aircraft = fetch_adsb(DEFAULT_LAT, DEFAULT_LNG, RADIUS_KM)
    except Exception as e:
        print(f'FETCH_ERROR {now_dt} {e}', flush=True)
        # Still update heartbeat so we know tracker ran but feed was down
        save_heartbeat(now_ts, -1)
        return

    total_seen = len(aircraft)
    sorties = load_sorties()
    mutated_sorties = False
    found_hexes = set()

    for ac in aircraft:
        hex_code = (ac.get('hex') or '').upper()
        if hex_code not in KNOWN_AIRCRAFT:
            continue

        found_hexes.add(hex_code)
        known = KNOWN_AIRCRAFT[hex_code]

        # Extract fields using adsb.lol field mapping
        lat = ac.get('lat')
        lon = ac.get('lon')
        if lat is None or lon is None:
            continue

        callsign = (ac.get('flight') or '').strip() or known['callsign']
        alt_raw = float(ac.get('alt_geom', 0) or 0)
        if alt_raw <= 0:
            alt_raw = float(ac.get('alt_baro', 0) or 0)
        alt = round(alt_raw * 3.28084)  # metres -> feet
        gs_knots = round(float(ac.get('gs', 0) or 0) * 1.94384)   # m/s -> knots
        heading = round(ac.get('track', 0) or 0)
        registration = ac.get('r') or known.get('registration', '')
        baro_rate_raw = float(ac.get('baro_rate', 0) or 0)
        vert_rate_fpm = round(baro_rate_raw * 196.85)  # m/s -> ft/min

        # Build history entry
        entry = {
            'ts': now_ts,
            'hex': hex_code,
            'callsign': callsign,
            'lat': lat,
            'lon': lon,
            'alt': alt,
            'gs': gs_knots,
            'heading': heading,
            'vr': vert_rate_fpm,
            'registration': registration,
            'type': known['type'],
            'source': 'adsb.lol',
        }
        append_history(entry)

        # Sortie tracking
        if hex_code not in sorties:
            # New sortie — aircraft just appeared
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
            mutated_sorties = True
            duration_sec = (now_ts - sorties[hex_code]['startTime']) / 1000
            dur_min = round(duration_sec / 60)
            print(f'SORTIE_START {hex_code} {callsign} — now={now_dt}', flush=True)
        else:
            # Update existing sortie
            s = sorties[hex_code]
            s['lastSeen'] = now_ts
            # Calculate distance traveled since last tick
            last_lat = s.get('lastLat', s['latestLat'])
            last_lon = s.get('lastLon', s['latestLon'])
            tick_dist = haversine_km(last_lat, last_lon, lat, lon)
            s['distKm'] = round(s.get('distKm', 0) + tick_dist, 2)
            s['lastLat'] = lat
            s['lastLon'] = lon
            s['latestLat'] = lat
            s['latestLon'] = lon
            if alt > s.get('peakAlt', 0):
                s['peakAlt'] = alt
            if s.get('status') == 'ended':
                s['status'] = 'active'
            mutated_sorties = True

        duration_sec = (now_ts - sorties[hex_code]['startTime']) / 1000
        dur_min = round(duration_sec / 60)
        dist = sorties[hex_code].get('distKm', 0)
        print(f'SEEN {hex_code} {callsign} @ {alt}ft {gs_knots}kt hdg={heading} vr={vert_rate_fpm}fpm — {dur_min}m flown, {dist}km — {now_dt}', flush=True)

    # Check for aircraft that disappeared
    for hex_code in list(sorties.keys()):
        if hex_code not in found_hexes and sorties[hex_code]['status'] == 'active':
            # Check if it's been gone more than one tick (15min)
            # One tick gap is acceptable — the 15-min polling might miss it
            elapsed_since_last = (now_ts - sorties[hex_code]['lastSeen']) / 1000
            if elapsed_since_last > 900:  # > 15 minutes = really gone
                s = sorties[hex_code]
                s['status'] = 'ended'
                s['endTime'] = now_ts
                mutated_sorties = True
                duration_sec = (now_ts - s['startTime']) / 1000
                dur_min = round(duration_sec / 60)
                dist = s.get('distKm', 0)
                peak_alt = s.get('peakAlt', 0)
                print(f'SORTIE_END {hex_code} {s["callsign"]} — flew {dur_min}m, {dist}km, peak {peak_alt}ft, ended {now_dt}', flush=True)

    if mutated_sorties:
        save_sorties(sorties)

    # Always write heartbeat — stay silent if no known aircraft
    save_heartbeat(now_ts, len(found_hexes))


if __name__ == '__main__':
    main()
