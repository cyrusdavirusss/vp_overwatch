"use client";

/**
 * VP·OVERWATCH — VPHeader component
 * ─────────────────────────────────────────────────────────────────────────
 * Fluid WebGL-inspired dark header with animated radial glows.
 * Replaces the existing header in page.tsx.
 *
 * Usage in page.tsx:
 *   import { VPHeader } from "@/components/vp-header";
 *   <VPHeader
 *     airCount={activeAircraft.length}
 *     gndCount={groundUnits.length}
 *     silentCount={silentAircraft.length}
 *     isLostSignal={lostSignalActive}
 *     isConnected={isConnected}
 *     onSubscribeClick={() => setShowSubscribe(true)}
 *   />
 *
 * Requires vp-theme.css to be imported in layout.tsx.
 */

import { useState, useEffect } from "react";

interface VPHeaderProps {
  airCount: number;
  gndCount: number;
  silentCount: number;
  isLostSignal: boolean;
  isConnected: boolean;
  onSubscribeClick: () => void;
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");
  return (
    <span className="vp-metric" style={{ fontSize: 10 }}>
      {hh}:{mm}:{ss}{" "}
      <span style={{ color: "rgba(255,255,255,0.25)" }}>AEST</span>
    </span>
  );
}

// Inline SVG icons — no external dependency needed
const BellIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const WifiIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);
const WifiOffIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
    <path d="M5 12.55a11 11 0 0 1 5.17-2.39" />
    <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

export function VPHeader({
  airCount,
  gndCount,
  silentCount,
  isLostSignal,
  isConnected,
  onSubscribeClick,
}: VPHeaderProps) {
  return (
    <header className={`vp-header ${isLostSignal ? "vp-lost" : ""}`}>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          height: "100%",
          padding: "0 16px",
          gap: 16,
        }}
      >
        {/* Wordmark */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
          <div className="vp-wordmark">VP·OVERWATCH</div>
          <div className="vp-subtitle">Melbourne Tactical</div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

        {/* Metrics */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="vp-metric">
            AIR <span className="air">{String(airCount).padStart(2, "0")}</span>
          </span>
          <span className="vp-metric">
            GND <span className="gnd">{String(gndCount).padStart(2, "0")}</span>
          </span>
          {silentCount > 0 && (
            <span className="vp-metric">
              SILENT <span className="silent">{String(silentCount).padStart(2, "0")}</span>
            </span>
          )}
          {isLostSignal && (
            <span className="vp-metric">
              <span className="lost">⚠ LOST SIGNAL</span>
            </span>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Controls */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <LiveClock />
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)" }} />

          {/* Connection status */}
          <button
            className={`vp-btn ${isConnected ? "vp-btn--active" : ""}`}
            title={isConnected ? "Live — connected" : "Disconnected"}
            style={!isConnected ? { color: "var(--vp-red)", borderColor: "rgba(255,45,45,0.3)" } : {}}
          >
            {isConnected ? <WifiIcon /> : <WifiOffIcon />}
            <span>{isConnected ? "LIVE" : "OFFLINE"}</span>
          </button>

          {/* Subscribe */}
          <button
            className="vp-btn vp-btn--subscribe"
            onClick={onSubscribeClick}
            aria-label="Subscribe to Hermes AI alerts"
          >
            <BellIcon />
            <span>SUBSCRIBE</span>
          </button>
        </div>
      </div>
    </header>
  );
}
