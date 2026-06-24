"use client";

/**
 * VP·OVERWATCH — OnAirBar component (adapted to the live Aircraft model)
 * ─────────────────────────────────────────────────────────────────────────
 * Horizontal scrollable chip bar showing all tracked aircraft.
 * Clicking a chip selects/deselects it (calls onSelect).
 *
 * Requires vp-theme.css to be imported in layout.tsx.
 */

import type { Aircraft } from "@/lib/data";

interface OnAirBarProps {
  aircraft: Aircraft[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function OnAirBar({ aircraft, selectedId, onSelect }: OnAirBarProps) {
  return (
    <div className="vp-onair-bar">
      <span className="vp-onair-label">ON AIR</span>

      {aircraft.length === 0 && (
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.15)", letterSpacing: "0.1em" }}>
          NO AIRCRAFT TRACKED
        </span>
      )}

      {aircraft.map((ac) => {
        // Live model: "silent" = was airborne but has dropped off radar.
        const isSilent = ac.isActive === false && ac.lastSeen !== null;
        const isSelected = selectedId === ac.id;
        return (
          <div
            key={ac.id}
            className={[
              "vp-onair-chip",
              isSilent ? "vp-silent" : "",
              isSelected ? "vp-selected" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => onSelect(isSelected ? null : ac.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect(isSelected ? null : ac.id)}
            aria-pressed={isSelected}
            aria-label={`${ac.callsign} — ${ac.type}`}
          >
            <div className={`vp-onair-dot ${isSilent ? "vp-silent" : ""}`} />
            <span className="vp-onair-callsign">{ac.callsign || ac.registration}</span>
            <span className="vp-onair-type">{ac.type}</span>
          </div>
        );
      })}
    </div>
  );
}
