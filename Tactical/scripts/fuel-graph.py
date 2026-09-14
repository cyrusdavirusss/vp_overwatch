#!/usr/bin/env python3
"""
VP-Overwatch per-helicopter fuel dashboard.

Renders one graph per aircraft from the collected flight tracks
(data/fuel-flights/<HEX>.jsonl) and their fuel scores (<HEX>.scores.jsonl,
written by fuel-score.ts). Focused on the fuel-ratio question: burn per flight,
average fuel flow vs the model's loiter/cruise references, and the altitude /
speed profile of the latest flight.

Run:  python3 scripts/fuel-graph.py                  (all aircraft with data)
      python3 scripts/fuel-graph.py --hex 7c4ef5
Output: data/fuel-flights/<CALLSIGN>.png
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "data", "fuel-flights")

# Model reference fuel flows (kg/h) — keep in sync with lib/fuel-model.ts PERF_*.
PERF_REF = {
    "AW139": {"loiter": 335, "cruise": 410},
    "EC135": {"loiter": 160, "cruise": 205},
    "B350": {"loiter": 162, "cruise": 185},
    "C208": {"loiter": 162, "cruise": 185},
}
ACCENT, DAYC, NIGHTC, FG, LOITERC, CRUISEC = "#58a6ff", "#f2cc60", "#7c5cff", "#c9d1d9", "#3fb950", "#f85149"


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def style(ax):
    ax.set_facecolor("#161b22")
    for sp in ax.spines.values():
        sp.set_color("#30363d")
    ax.tick_params(colors=FG, labelsize=8)
    ax.grid(True, color="#21262d", lw=0.6)
    ax.title.set_color(FG); ax.xaxis.label.set_color(FG); ax.yaxis.label.set_color(FG)


def render(hexid, flights, scores):
    if not flights:
        return None
    meta = flights[0]["meta"]
    cs = meta.get("callsign", hexid)
    typ = meta.get("type", "")
    ref = PERF_REF.get(typ, {"loiter": None, "cruise": None})
    # merge scores by start_iso
    score_by = {s.get("start_iso"): s for s in scores}
    flights = sorted(flights, key=lambda f: f["summary"].get("start_iso", ""))
    latest = flights[-1]

    n = len(flights)
    scored = [score_by.get(f["summary"].get("start_iso")) for f in flights]
    burned = [s["fuel_burned_kg"] if s else None for s in scored]
    flow = [s["avg_fuel_flow_kgh"] if s else None for s in scored]
    durs = [f["summary"].get("duration_min") for f in flights]
    total_fuel = round(sum(b for b in burned if b), 1)
    mean_flow = round(sum(x for x in flow if x) / max(1, len([x for x in flow if x])), 1) if any(flow) else None
    per_km = [s.get("fuel_per_km_kg") for s in scored if s and s.get("fuel_per_km_kg")]
    mean_km = round(sum(per_km) / len(per_km), 2) if per_km else None
    wind_note = next((f"winds {s['winds']}" for s in scored if s and s.get("winds")), "winds n/a")

    fig = plt.figure(figsize=(14, 9), dpi=110)
    fig.patch.set_facecolor("#0d1117")
    gs = fig.add_gridspec(3, 2, height_ratios=[1, 1, 1], hspace=0.62, wspace=0.22,
                          left=0.07, right=0.96, top=0.80, bottom=0.08)

    fig.text(0.07, 0.955, cs, color=ACCENT, fontsize=26, fontweight="bold")
    fig.text(0.07, 0.915, f"{meta.get('operator','VicPol Air Wing')}  ·  {typ}  ·  ICAO {hexid.upper()}  ·  {wind_note}",
             color=FG, fontsize=11)
    kpi = f"{n} flights collected"
    if mean_flow: kpi += f"   |   {total_fuel:.0f} kg burned   |   mean {mean_flow:.0f} kg/h"
    if mean_km: kpi += f"   |   {mean_km:.2f} kg/km"
    fig.text(0.07, 0.885, kpi, color=DAYC, fontsize=10.5, family="monospace")

    # 1: fuel burned per flight (bar) + avg fuel flow (markers, right axis)
    ax = fig.add_subplot(gs[0, :]); style(ax)
    ax.set_title("Fuel burned per flight (bar) + avg fuel flow (dots, right axis)", loc="left")
    xs = range(n)
    ax.bar(xs, [b or 0 for b in burned], color=ACCENT, width=0.6)
    ax.set_ylabel("fuel burned (kg)")
    ax.set_xticks(list(xs))
    ax.set_xticklabels([(f["summary"].get("start_iso", "")[5:16].replace("T", " ")) for f in flights],
                       rotation=40, ha="right", fontsize=7)
    ax2 = ax.twinx()
    ax2.plot(xs, flow, "o-", color=DAYC, ms=5, lw=1)
    ax2.tick_params(colors=FG, labelsize=8)
    if ref["loiter"]:
        ax2.axhline(ref["loiter"], color=LOITERC, ls="--", lw=1)
        ax2.axhline(ref["cruise"], color=CRUISEC, ls="--", lw=1)
        ax2.text(n - 0.5, ref["loiter"], " loiter", color=LOITERC, fontsize=7, va="center")
        ax2.text(n - 0.5, ref["cruise"], " cruise", color=CRUISEC, fontsize=7, va="center")
    ax2.set_ylabel("avg fuel flow (kg/h)", color=DAYC)

    # 2: latest flight altitude profile
    ax = fig.add_subplot(gs[1, 0]); style(ax)
    ax.set_title(f"Latest flight — altitude (ft)", loc="left")
    ls = latest["samples"]
    t = [(s.get("tSec") if s.get("tSec") is not None else (s["ts"] - ls[0]["ts"]) / 1000) / 60 for s in ls]
    alt = [s.get("altFt") for s in ls]
    ax.plot(t, alt, color=DAYC, lw=1.4)
    ax.fill_between(t, 0, alt, color=DAYC, alpha=0.12)
    ax.set_xlabel("min"); ax.set_ylabel("ft")

    # 3: latest flight groundspeed profile
    ax = fig.add_subplot(gs[1, 1]); style(ax)
    ax.set_title("Latest flight — groundspeed (kt)", loc="left")
    gsp = [s.get("gsKt") for s in ls]
    ax.plot(t, gsp, color=NIGHTC, lw=1.4)
    ax.set_xlabel("min"); ax.set_ylabel("kt")

    # 4: fuel-flow vs duration (calibration cloud) with model refs
    ax = fig.add_subplot(gs[2, 0]); style(ax)
    ax.set_title("Fuel flow vs duration (calibration cloud)", loc="left")
    xd = [d for d, fl in zip(durs, flow) if fl]
    yf = [fl for fl in flow if fl]
    ax.scatter(xd, yf, color=ACCENT, s=28)
    if ref["loiter"]:
        ax.axhline(ref["loiter"], color=LOITERC, ls="--", lw=1, label="model loiter")
        ax.axhline(ref["cruise"], color=CRUISEC, ls="--", lw=1, label="model cruise")
        ax.legend(fontsize=7, facecolor="#161b22", labelcolor=FG, edgecolor="#30363d")
    ax.set_xlabel("duration (min)"); ax.set_ylabel("avg fuel flow (kg/h)")

    # 5: sortie durations
    ax = fig.add_subplot(gs[2, 1]); style(ax)
    ax.set_title("Sortie duration (min)", loc="left")
    ax.bar(xs, [d or 0 for d in durs], color=DAYC, width=0.6)
    ax.set_xlabel("flight #"); ax.set_ylabel("min")

    fig.text(0.07, 0.02, "collected by fuel-collector.py · scored by fuel-score.ts (real fuel-model.ts) · generated by fuel-graph.py",
             color="#6e7681", fontsize=8)

    out = os.path.join(DATA_DIR, f"{cs}.png")
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)
    return out


def main():
    global DATA_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--hex")
    ap.add_argument("--dir", default=DATA_DIR)
    args = ap.parse_args()
    DATA_DIR = args.dir

    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.jsonl")))
    hexes = [os.path.basename(f)[:-6] for f in files
             if re.fullmatch(r"[0-9a-fA-F]{6}", os.path.basename(f)[:-6])]
    if args.hex:
        hexes = [h for h in hexes if h.lower() == args.hex.lower()]
    if not hexes:
        print("no completed-flight data found yet")
        return
    for h in hexes:
        flights = read_jsonl(os.path.join(DATA_DIR, f"{h}.jsonl"))
        scores = read_jsonl(os.path.join(DATA_DIR, f"{h}.scores.jsonl"))
        out = render(h, flights, scores)
        if out:
            print(f"{flights[0]['meta'].get('callsign', h)}: {len(flights)} flights -> {out}")


if __name__ == "__main__":
    main()
