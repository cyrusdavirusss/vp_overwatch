"use client";

/**
 * VP·OVERWATCH — AircraftDetail panel (v2, adapted to the live Aircraft model)
 * ─────────────────────────────────────────────────────────────────────────
 * Absolute right-side panel (desktop) / bottom 60% (mobile, via vp-theme.css).
 * Uses vp-theme.css classes.
 */

import type { Aircraft } from "@/lib/data";

interface AircraftDetailProps {
  aircraft: Aircraft;
  onClose: () => void;
}

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function fuelLevel(pct: number): "high" | "medium" | "low" {
  if (pct > 50) return "high";
  if (pct > 20) return "medium";
  return "low";
}

// Live model: source is 'adsb' | 'mlat' | 'mode_s' | 'unknown'.
function getSourceClass(ac: Aircraft): string {
  if (ac.source === "mlat" || ac.isMlat) return "mlat";
  if (ac.source === "adsb") return "adsb";
  return "modes";
}
function getSourceText(ac: Aircraft): string {
  if (ac.source === "mlat" || ac.isMlat) return "MLAT";
  if (ac.source === "adsb") return "ADS-B";
  return "MODE-S";
}

export function AircraftDetail({ aircraft: ac, onClose }: AircraftDetailProps) {
  // "lost" = was airborne and has dropped off radar; "silent" = active but
  // only MLAT/Mode-S (degraded source, position/altitude unreliable).
  const isLost = ac.isActive === false && ac.lastSeen !== null;
  const isSilent = ac.isActive === true && (ac.isModeS === true || ac.isMlat === true);

  const fuelPct = ac.fuelRemainingPercent ?? 100;
  const fl = fuelLevel(fuelPct);
  const endMin = ac.fuelEnduranceMinutes ?? 240;
  const remainMin = Math.round((fuelPct / 100) * endMin);
  const airtimeMin = Math.round((ac.timeAirborneSeconds ?? 0) / 60);
  const lastTp = ac.track && ac.track.length ? ac.track[ac.track.length - 1] : null;
  const verticalRate = lastTp ? lastTp.vs : null;

  return (
    <div className={`vp-detail-panel ${isLost ? "vp-lost" : ""}`}>

      {/* Header */}
      <div className="vp-panel-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="vp-panel-callsign">{ac.callsign || ac.registration || ac.hex}</div>
            <div className="vp-panel-type">
              {ac.type || "UNKNOWN"} · {ac.operator || "VicPol Air Wing"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 4, marginTop: -2 }}
            aria-label="Close panel"
          >
            <XIcon />
          </button>
        </div>

        {/* Source + status badges */}
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`vp-badge ${getSourceClass(ac)}`}>{getSourceText(ac)}</span>
          {isSilent && <span className="vp-badge silent">SILENT</span>}
          {isLost && <span className="vp-badge lost">LOST</span>}
        </div>
      </div>

      {/* Lost signal banner */}
      {isLost && (
        <div className="vp-lost-banner">
          <span>⚠</span>
          LOST SIGNAL — AIRBORNE {airtimeMin}min
        </div>
      )}

      {/* Data rows */}
      <div className="vp-panel-row">
        <span className="vp-panel-key">ALTITUDE</span>
        <span className="vp-panel-val cyan">
          {ac.altitude != null ? `${ac.altitude.toLocaleString()} ft` : "—"}
        </span>
      </div>
      <div className="vp-panel-row">
        <span className="vp-panel-key">SPEED</span>
        <span className="vp-panel-val">
          {ac.speed != null ? `${ac.speed} kts` : "—"}
        </span>
      </div>
      <div className="vp-panel-row">
        <span className="vp-panel-key">HEADING</span>
        <span className="vp-panel-val">
          {ac.heading != null ? `${ac.heading}°` : "—"}
        </span>
      </div>
      <div className="vp-panel-row">
        <span className="vp-panel-key">VERTICAL</span>
        <span className="vp-panel-val">
          {verticalRate != null
            ? `${verticalRate > 0 ? "+" : ""}${verticalRate} fpm`
            : "—"}
        </span>
      </div>
      <div className="vp-panel-row">
        <span className="vp-panel-key">AIRBORNE</span>
        <span className="vp-panel-val amber">
          {airtimeMin > 0 ? `${airtimeMin} min` : "—"}
        </span>
      </div>
      <div className="vp-panel-row">
        <span className="vp-panel-key">REGO</span>
        <span className="vp-panel-val">{ac.registration || "—"}</span>
      </div>
      <div className="vp-panel-row">
        <span className="vp-panel-key">ICAO</span>
        <span className="vp-panel-val" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          {ac.hex}
        </span>
      </div>

      {/* Fuel bar */}
      <div className="vp-fuel-wrap">
        <div className="vp-fuel-label">
          <span className="vp-panel-key">FUEL EST.</span>
          <span
            className="vp-panel-val"
            style={{
              fontSize: 10,
              color: fl === "low" ? "var(--vp-red)" : fl === "medium" ? "var(--vp-amber)" : "var(--vp-cyan)",
            }}
          >
            {Math.round(fuelPct)}% · ~{remainMin}min
          </span>
        </div>
        <div className="vp-fuel-track">
          <div className={`vp-fuel-fill ${fl}`} style={{ width: `${fuelPct}%` }} />
        </div>
      </div>

      {/* Signal intermittent warning */}
      {isSilent && !isLost && (
        <div className="vp-signal-warn">
          <div className="vp-signal-warn-title">⚠ SIGNAL INTERMITTENT</div>
          <div className="vp-signal-warn-body">
            {getSourceText(ac)} only — position approximate, altitude unreliable.
          </div>
        </div>
      )}
    </div>
  );
}
