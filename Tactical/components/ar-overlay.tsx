"use client";

/**
 * VP·OVERWATCH — AROverlay (v2, vp-theme styling, adapted to the live model)
 * ─────────────────────────────────────────────────────────────────────────
 * "Paranoid Schizophrenia" AR camera overlay with PING SKY.
 * Reticles for known aircraft + community sighting dots.
 * Uses your live CommunityDot type and posts in your /api/sighting schema.
 */

import { useState, useCallback } from "react";
import type { Aircraft } from "@/lib/data";
import type { CommunityDot } from "@/lib/visual-sighting";

interface AROverlayProps {
  aircraft: Aircraft[];
  communityDots: CommunityDot[];
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
}

// Distribute reticles across the upper portion of the screen (a real
// implementation would use device orientation + bearing).
function reticlePosition(index: number, total: number): { left: string; top: string } {
  const spread = 60;
  const startX = 50 - spread / 2;
  const x = total > 1 ? startX + (index / (total - 1)) * spread : 50;
  const y = 25 + (index % 3) * 8;
  return { left: `${x}%`, top: `${y}%` };
}

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem("vp-session");
    if (!id) {
      id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem("vp-session", id);
    }
    return id;
  } catch {
    return `s-${Date.now()}`;
  }
}

export function AROverlay({ aircraft, communityDots, userLocation, onClose }: AROverlayProps) {
  const [pinged, setPinged] = useState(false);
  const [pingCount, setPingCount] = useState(0);

  const handlePing = useCallback(async () => {
    if (!userLocation) {
      alert("GPS location required for PING SKY. Enable location access.");
      return;
    }
    let bearing: number | null = null;
    let elevation: number | null = null;
    try {
      const orient = (window as any).__vpOrientation;
      if (orient) {
        bearing = orient.alpha ?? null;
        elevation = orient.beta != null ? 90 - orient.beta : null;
      }
    } catch { /* submit without orientation */ }

    try {
      // Live /api/sighting schema: a visual-sighting ray for an aircraft hex.
      // Blind-sky pings use a shared "UNKNOWN" hex so they triangulate together.
      await fetch("/api/sighting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aircraftHex: "UNKNOWN",
          observerLat: userLocation.lat,
          observerLng: userLocation.lng,
          bearingDeg: bearing ?? 0,
          elevationDeg: elevation ?? 45,
          sessionId: getSessionId(),
        }),
      });
    } catch { /* offline — still confirm */ }
    setPingCount((c) => c + 1);
    setPinged(true);
  }, [userLocation]);

  return (
    <div className="vp-ar-overlay" role="dialog" aria-label="AR Camera Overlay">

      {/* Camera feed placeholder */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,20,40,0.6)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <span style={{ color: "rgba(255,255,255,0.12)", fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "0.2em" }}>
          CAMERA FEED — POINT AT SKY
        </span>
      </div>

      {/* Crosshair */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 60, height: 60, pointerEvents: "none" }}>
        <div style={{ position: "absolute", width: 1, height: "100%", left: "50%", background: "rgba(255,255,255,0.2)" }} />
        <div style={{ position: "absolute", height: 1, width: "100%", top: "50%", background: "rgba(255,255,255,0.2)" }} />
      </div>

      {/* Aircraft reticles */}
      {aircraft.map((ac, i) => {
        const pos = reticlePosition(i, aircraft.length);
        return (
          <div key={ac.id} className="vp-ar-reticle" style={pos}>
            <div className="vp-ar-ring">
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--vp-cyan)" }} />
            </div>
            <div className="vp-ar-label">
              {ac.callsign || ac.hex} · {ac.altitude != null ? `${ac.altitude}ft` : "?ft"}
            </div>
          </div>
        );
      })}

      {/* Community dot reticles */}
      {communityDots.slice(0, 3).map((dot, i) => {
        const pos = reticlePosition(i + aircraft.length, aircraft.length + communityDots.length);
        return (
          <div key={dot.aircraftHex} className="vp-ar-reticle" style={pos}>
            <div className="vp-ar-ring purple">
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a78bfa" }} />
            </div>
            <div className="vp-ar-label purple">
              UNKNOWN · {dot.sightingCount} PING{dot.sightingCount !== 1 ? "S" : ""}
            </div>
          </div>
        );
      })}

      {/* PING SKY button / confirmation */}
      {!pinged ? (
        <button className="vp-ar-ping" onClick={handlePing} aria-label="Submit visual sighting">
          PING SKY
        </button>
      ) : (
        <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#a78bfa", letterSpacing: "0.15em", marginBottom: 6 }}>
            ✓ SIGHTING SUBMITTED — {pingCount} PING{pingCount !== 1 ? "S" : ""}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            {3 - pingCount > 0
              ? `${3 - pingCount} more ping${3 - pingCount !== 1 ? "s" : ""} needed to confirm`
              : "✓ CONFIRMED — community dot promoted"}
          </div>
          <button
            onClick={() => setPinged(false)}
            style={{ marginTop: 10, background: "none", border: "none", color: "rgba(139,92,246,0.5)", fontFamily: "'Space Mono', monospace", fontSize: 9, cursor: "pointer", letterSpacing: "0.1em" }}
          >
            PING AGAIN
          </button>
        </div>
      )}

      {/* Exit button */}
      <button className="vp-ar-exit" onClick={onClose} aria-label="Exit AR mode">
        EXIT AR
      </button>
    </div>
  );
}
