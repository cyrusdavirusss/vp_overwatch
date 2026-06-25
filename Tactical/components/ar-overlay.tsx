"use client";

/**
 * VP·OVERWATCH — AROverlay (v3 — live camera + compass-aligned sky contacts)
 * ─────────────────────────────────────────────────────────────────────────
 * Point the phone at the sky: the rear camera is the background, and every
 * aircraft in range (law-enforcement + civil) is drawn as a reticle at its real
 * bearing/elevation using the device compass + tilt. The aircraft nearest the
 * centre crosshair (or one you tap) gets a detailed info box — callsign, hex,
 * altitude, LE/CIVIL tag + operator, distance, and the plane's own heading.
 *
 * Camera + compass require a secure context (HTTPS); served over plain HTTP the
 * component degrades to a dark background with an index-spread fallback so the
 * info boxes still work.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { Aircraft } from "@/lib/data";
import type { CommunityDot } from "@/lib/visual-sighting";

interface AROverlayProps {
  aircraft: Aircraft[];
  communityDots: CommunityDot[];
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
}

// Approximate rear-camera field of view (portrait). Tweak to taste — wider FOV
// makes reticles easier to catch but less precisely aligned.
const HFOV = 60;
const VFOV = 100;
// A reticle within this %-radius of screen centre is "in the crosshair".
const TARGET_RADIUS_PCT = 14;

const AMBER = "#ffb000";
const CYAN = "#22d3ee";

// ── Geometry ───────────────────────────────────────────────────────────────
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial great-circle bearing user→target, degrees 0–360 (0 = N, 90 = E). */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Normalise an angle delta to [-180, 180]. */
function norm180(d: number): number {
  let x = ((d + 180) % 360) - 180;
  if (x < -180) x += 360;
  return x;
}

const compassDir = (deg: number): string => {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
};

const fmtDist = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

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

interface Orientation {
  heading: number | null; // compass degrees, 0 = north
  pitch: number; // camera elevation above horizon, degrees
}

interface Projected {
  ac: Aircraft;
  xPct: number;
  yPct: number;
  onScreen: boolean;
  distM: number;
  elevDeg: number;
  centreDist: number; // %-distance from screen centre, for targeting
  isLE: boolean;
}

export function AROverlay({ aircraft, communityDots, userLocation, onClose }: AROverlayProps) {
  const [pinged, setPinged] = useState(false);
  const [pingCount, setPingCount] = useState(0);
  const [contacts, setContacts] = useState<Aircraft[]>(aircraft);
  const [orient, setOrient] = useState<Orientation>({ heading: null, pitch: 45 });
  const [lockedHex, setLockedHex] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ── Live rear camera ──────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError("Camera unavailable (needs HTTPS)");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        setCamError(e?.name === "NotAllowedError" ? "Camera permission denied" : "Camera unavailable (needs HTTPS)");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Device orientation (compass heading + tilt) ───────────────────────────
  useEffect(() => {
    let active = true;
    // Once the absolute (true-north) feed arrives, ignore the relative
    // deviceorientation stream — on Android both fire and the relative one drifts.
    let gotAbsolute = false;

    const apply = (e: DeviceOrientationEvent, absolute: boolean) => {
      if (!active) return;
      const anyE = e as any;
      // iOS exposes true compass heading directly; otherwise absolute alpha is
      // counter-clockwise from north, so heading = 360 - alpha.
      let heading: number | null = null;
      if (typeof anyE.webkitCompassHeading === "number") heading = anyE.webkitCompassHeading;
      else if (absolute && e.alpha != null) heading = (360 - e.alpha) % 360;
      else if (e.alpha != null) heading = (360 - e.alpha) % 360; // last-resort fallback
      // beta ≈ 90 when the phone is upright pointing at the horizon; tilting the
      // top back to look up increases beta. Camera elevation ≈ beta - 90.
      const pitch = e.beta != null ? e.beta - 90 : 45;
      setOrient({ heading, pitch });
    };

    const handleAbsolute = (e: DeviceOrientationEvent) => {
      gotAbsolute = true;
      apply(e, true);
    };
    const handleRelative = (e: DeviceOrientationEvent) => {
      if (gotAbsolute) return;
      apply(e, (e as any).absolute === true);
    };

    const start = () => {
      window.addEventListener("deviceorientationabsolute", handleAbsolute as any, true);
      window.addEventListener("deviceorientation", handleRelative, true);
    };

    // iOS 13+ requires an explicit permission grant from a user gesture.
    const anyDOE = DeviceOrientationEvent as any;
    if (typeof anyDOE?.requestPermission === "function") {
      anyDOE
        .requestPermission()
        .then((res: string) => {
          if (res === "granted") start();
        })
        .catch(() => {});
    } else {
      start();
    }
    return () => {
      active = false;
      window.removeEventListener("deviceorientationabsolute", handleAbsolute as any, true);
      window.removeEventListener("deviceorientation", handleRelative, true);
    };
  }, []);

  // ── Poll the sky feed (LE + civil) while the overlay is open ───────────────
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/aircraft/sky", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as Aircraft[];
        if (active && Array.isArray(data)) setContacts(data);
      } catch {
        /* keep last good list */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // ── Project contacts onto the screen ──────────────────────────────────────
  const projected = useMemo<Projected[]>(() => {
    if (!userLocation) return [];
    const total = contacts.length;
    return contacts.map((ac, i): Projected => {
      const distM = haversineM(userLocation.lat, userLocation.lng, ac.latitude, ac.longitude);
      const altM = (ac.altitude ?? 0) * 0.3048;
      const elevDeg = distM > 0 ? toDeg(Math.atan2(altM, distM)) : 90;
      const isLE = ac.category !== "civil";

      let xPct: number;
      let yPct: number;
      let onScreen: boolean;

      if (orient.heading != null) {
        const relBear = norm180(bearingDeg(userLocation.lat, userLocation.lng, ac.latitude, ac.longitude) - orient.heading);
        const relElev = elevDeg - orient.pitch;
        xPct = 50 + (relBear / (HFOV / 2)) * 50;
        yPct = 50 - (relElev / (VFOV / 2)) * 50;
        onScreen = Math.abs(relBear) <= HFOV / 2 && Math.abs(relElev) <= VFOV / 2;
      } else {
        // No compass (e.g. plain HTTP): spread across the upper screen so the
        // info boxes still work via tap.
        const spread = 64;
        const startX = 50 - spread / 2;
        xPct = total > 1 ? startX + (i / (total - 1)) * spread : 50;
        yPct = 22 + (i % 4) * 9;
        onScreen = true;
      }

      const centreDist = Math.hypot(xPct - 50, yPct - 50);
      return { ac, xPct, yPct, onScreen, distM, elevDeg, centreDist, isLE };
    });
  }, [contacts, userLocation, orient]);

  // Target = locked contact, else the on-screen reticle nearest the crosshair.
  const target = useMemo<Projected | null>(() => {
    if (lockedHex) {
      const l = projected.find((p) => p.ac.hex === lockedHex);
      if (l) return l;
    }
    const inCross = projected
      .filter((p) => p.onScreen && p.centreDist <= TARGET_RADIUS_PCT)
      .sort((a, b) => a.centreDist - b.centreDist);
    return inCross[0] ?? null;
  }, [projected, lockedHex]);

  const handlePing = useCallback(async () => {
    if (!userLocation) {
      alert("GPS location required for PING SKY. Enable location access.");
      return;
    }
    let bearing: number | null = orient.heading;
    let elevation: number | null = orient.pitch;
    try {
      await fetch("/api/sighting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aircraftHex: target?.ac.hex ?? "UNKNOWN",
          observerLat: userLocation.lat,
          observerLng: userLocation.lng,
          bearingDeg: bearing ?? 0,
          elevationDeg: elevation ?? 45,
          sessionId: getSessionId(),
        }),
      });
    } catch {
      /* offline — still confirm */
    }
    setPingCount((c) => c + 1);
    setPinged(true);
  }, [userLocation, orient, target]);

  return (
    <div
      className="vp-ar-overlay"
      role="dialog"
      aria-label="AR Camera Overlay"
      onClick={() => setLockedHex(null)}
    >
      {/* Live camera background */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#001428" }}
      />
      {camError && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "0.2em", textAlign: "center" }}>
            {camError.toUpperCase()}
            <br />POINT AT SKY
          </span>
        </div>
      )}

      {/* Heading tape */}
      <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", fontFamily: "'Space Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.7)", letterSpacing: "0.15em", pointerEvents: "none" }}>
        {orient.heading != null ? `${Math.round(orient.heading)}° ${compassDir(orient.heading)}` : "NO COMPASS"}
        {"  ·  "}
        {projected.filter((p) => p.onScreen).length}/{contacts.length} IN VIEW
      </div>

      {/* Crosshair */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 60, height: 60, pointerEvents: "none" }}>
        <div style={{ position: "absolute", width: 1, height: "100%", left: "50%", background: "rgba(255,255,255,0.25)" }} />
        <div style={{ position: "absolute", height: 1, width: "100%", top: "50%", background: "rgba(255,255,255,0.25)" }} />
      </div>

      {/* Aircraft reticles */}
      {projected.map((p) => {
        if (!p.onScreen) return null;
        const color = p.isLE ? AMBER : CYAN;
        const isTarget = target?.ac.hex === p.ac.hex;
        return (
          <div
            key={p.ac.id}
            onClick={(e) => {
              e.stopPropagation();
              setLockedHex(p.ac.hex);
            }}
            style={{
              position: "absolute",
              left: `${p.xPct}%`,
              top: `${p.yPct}%`,
              transform: "translate(-50%, -50%)",
              cursor: "pointer",
              zIndex: isTarget ? 5 : 3,
            }}
          >
            <div
              style={{
                width: isTarget ? 30 : 20,
                height: isTarget ? 30 : 20,
                borderRadius: "50%",
                border: `2px solid ${color}`,
                boxShadow: isTarget ? `0 0 14px ${color}` : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 120ms ease",
              }}
            >
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: color }} />
            </div>
            {!isTarget && (
              <div style={{ marginTop: 3, fontFamily: "'Space Mono', monospace", fontSize: 9, color, whiteSpace: "nowrap", textShadow: "0 1px 2px #000", letterSpacing: "0.05em" }}>
                {p.ac.callsign || p.ac.hex}
              </div>
            )}
          </div>
        );
      })}

      {/* Detail box for the targeted aircraft */}
      {target && (
        <InfoBox p={target} />
      )}

      {/* Community dot reticles (visual pings) */}
      {communityDots.slice(0, 3).map((dot, i) => (
        <div
          key={dot.aircraftHex}
          style={{ position: "absolute", left: `${20 + i * 25}%`, top: `${70}%`, transform: "translate(-50%, -50%)", pointerEvents: "none" }}
        >
          <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid #a78bfa", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#a78bfa" }} />
          </div>
          <div style={{ marginTop: 3, fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#a78bfa", whiteSpace: "nowrap", textShadow: "0 1px 2px #000" }}>
            {dot.sightingCount} PING{dot.sightingCount !== 1 ? "S" : ""}
          </div>
        </div>
      ))}

      {/* PING SKY button / confirmation */}
      {!pinged ? (
        <button className="vp-ar-ping" onClick={(e) => { e.stopPropagation(); handlePing(); }} aria-label="Submit visual sighting">
          PING SKY
        </button>
      ) : (
        <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#a78bfa", letterSpacing: "0.15em", marginBottom: 6 }}>
            ✓ SIGHTING SUBMITTED — {pingCount} PING{pingCount !== 1 ? "S" : ""}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setPinged(false); }}
            style={{ marginTop: 4, background: "none", border: "none", color: "rgba(139,92,246,0.6)", fontFamily: "'Space Mono', monospace", fontSize: 9, cursor: "pointer", letterSpacing: "0.1em" }}
          >
            PING AGAIN
          </button>
        </div>
      )}

      {/* Exit button */}
      <button className="vp-ar-exit" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Exit AR mode">
        EXIT AR
      </button>
    </div>
  );
}

// ── Detail box ───────────────────────────────────────────────────────────────
function InfoBox({ p }: { p: Projected }) {
  const { ac } = p;
  const color = p.isLE ? AMBER : CYAN;
  // Place the box beside the reticle, flipping to the left near the right edge
  // and clamping vertically so it stays on screen.
  const onRight = p.xPct > 60;
  const left = onRight ? undefined : `calc(${Math.min(p.xPct, 70)}% + 26px)`;
  const right = onRight ? `calc(${100 - Math.max(p.xPct, 30)}% + 26px)` : undefined;
  const top = `${Math.min(Math.max(p.yPct, 14), 74)}%`;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        right,
        top,
        transform: "translateY(-50%)",
        minWidth: 178,
        maxWidth: 230,
        background: "rgba(2,12,22,0.86)",
        border: `1px solid ${color}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        padding: "8px 10px",
        backdropFilter: "blur(6px)",
        fontFamily: "'Space Mono', monospace",
        color: "#e8f0f6",
        zIndex: 6,
        boxShadow: `0 0 18px ${color}40`,
      }}
    >
      {/* Header: callsign + LE/CIVIL badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color }}>
          {ac.callsign || ac.registration || ac.hex}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "#02101c", background: color, padding: "1px 5px", borderRadius: 3 }}>
          {p.isLE ? "LAW ENF" : "CIVIL"}
        </span>
      </div>

      <Row k="HEX" v={ac.hex} />
      <Row k="OPERATOR" v={ac.operator || (p.isLE ? "Law enforcement" : "Civil")} />
      <Row k="TYPE" v={ac.typeLabel || ac.type || "Unknown"} />
      <Row k="ALT" v={`${ac.altitude?.toLocaleString() ?? "?"} ft`} />
      <Row k="HEADING" v={`${Math.round(ac.heading ?? 0)}° ${compassDir(ac.heading ?? 0)}`} />
      <Row k="SPEED" v={`${Math.round(ac.speed ?? 0)} kt`} />
      <Row k="DISTANCE" v={fmtDist(p.distM)} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, lineHeight: 1.5 }}>
      <span style={{ color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>{k}</span>
      <span style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{v}</span>
    </div>
  );
}
