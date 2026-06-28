"use client";

/**
 * VP·OVERWATCH — AROverlay (v3 — live camera + compass-aligned sky contacts)
 * ─────────────────────────────────────────────────────────────────────────
 * Point the phone at the sky: the rear camera is the background, and each
 * aircraft in range is drawn as a reticle at its real bearing/elevation using
 * the device compass + tilt. Police-only by default — a CIVIL toggle shows/hides
 * civil flights. The aircraft nearest the centre crosshair (or one you tap) gets
 * a detailed info box — callsign, hex, altitude, operator, distance, and heading.
 * Ground units (police/cameras/checkpoints) appear as red horizon reticles.
 *
 * Camera + compass require a secure context (HTTPS); served over plain HTTP the
 * component degrades to a dark background with an index-spread fallback so the
 * info boxes still work.
 */

import { useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import type { Aircraft, Report } from "@/lib/data";
import type { CommunityDot } from "@/lib/visual-sighting";
import {
  cameraBasis,
  azElOf,
  dirFromAzEl,
  projectDir,
  smoothBasis,
  type CamBasis,
} from "@/lib/ar-orientation";

interface AROverlayProps {
  aircraft: Aircraft[];
  reports: Report[]; // ground units (police / cameras / checkpoints)
  communityDots: CommunityDot[];
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
}

// Approximate rear-camera field of view (portrait). Tweak to taste — wider FOV
// makes reticles easier to catch but less precisely aligned.
const HFOV = 60;
const VFOV = 100;
const AMBER = "#ffb000";
const CYAN = "#22d3ee";
// Ground units (police on the ground, cameras, checkpoints) get their own
// distinct colour + reticle shape so they never read as a sky contact. Matches
// the map's "confirmed ground threat" red (lib/markers RED #FF4757).
const GROUND = "#ff3b5c";

// ── Tunable AR behaviour ─────────────────────────────────────────────────────
// SMOOTHING: per-frame blend toward the live orientation (0–1). Lower = heavier
//   damping / stickier to your aim (more stable, slightly laggier); higher = snappier.
// LOCK_DWELL_MS / BREAK_DWELL_MS: hold the crosshair ON a contact this long to
//   lock it; while locked, hold the crosshair OFF it this long to release.
// LOCK_RADIUS_PCT: crosshair capture radius (% of screen) for dwell + targeting.
// HEADING_CALIBRATION_DEG: compass trim added to the camera azimuth. Melbourne
//   magnetic declination ≈ +11.5°E — nudge if reticles sit off the real target.
const SMOOTHING = 0.1;
const LOCK_DWELL_MS = 3_000;
const BREAK_DWELL_MS = 3_000;
const LOCK_RADIUS_PCT = 14;
const HEADING_CALIBRATION_DEG = 0;
// Screen-axis direction. If reticles "run away" / track backwards when you pan
// (a mirrored-axis device quirk), flip the offending one between +1 and −1.
// YAW_DIR = horizontal (left/right pan), PITCH_DIR = vertical (tilt up/down).
const YAW_DIR = -1;
const PITCH_DIR = 1;

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

const compassDir = (deg: number): string => {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
};

const fmtDist = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

// AR is police-only: civil flights are filtered out of the sky feed entirely.
const isLawEnforcement = (a: Aircraft): boolean => a.category !== "civil";

// Short tag for a ground unit reticle/label.
const groundLabel = (r: Report): string => {
  switch (r.kind) {
    case "marked": return "MARKED";
    case "unmarked": return "UNMARKED";
    case "hidden": return "HIDDEN";
    case "camera": return "CAMERA";
    case "stop": return "STOP";
    case "checkpoint": return "CHECKPT";
    case "rbt": return "RBT";
    default: return "GROUND";
  }
};

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

interface Projected {
  ac: Aircraft;
  xPct: number;
  yPct: number;
  onScreen: boolean;
  distM: number;
  elevDeg: number;
  centreDist: number; // %-distance from screen centre, for targeting
  isLE: boolean;
  bearing: number; // true compass bearing user→target (GPS-derived, not the phone compass)
}

// A ground unit projected to the AR view. Ground contacts sit on the horizon
// (elevation 0) at their GPS bearing, so they appear when you tilt the phone
// down toward street level — distinct from the sky contacts above.
interface ProjectedGround {
  r: Report;
  xPct: number;
  yPct: number;
  onScreen: boolean;
  distM: number;
  bearing: number;
}

// Per-frame view-model produced by the rAF engine (smoothed orientation +
// projected reticles + current target / dwell-lock state).
interface ViewModel {
  azimuth: number | null; // smoothed camera compass heading
  elevation: number; // smoothed camera elevation
  projected: Projected[];
  ground: ProjectedGround[]; // projected ground units (police/cameras on the ground)
  targetHex: string | null; // locked, else nearest-to-crosshair
  locked: boolean;
  dwellHex: string | null; // contact a lock/break dwell is counting on
  dwellProgress: number; // 0–1
  dwellMode: "lock" | "break";
  aimHint: string | null; // where the selected target is relative to current aim
  contactCount: number; // total contacts (for the cycle counter)
  manualIdx: number; // index of the manually-selected contact (distance order)
}

export function AROverlay({ aircraft, reports, communityDots, userLocation, onClose }: AROverlayProps) {
  const [pinged, setPinged] = useState(false);
  const [pingCount, setPingCount] = useState(0);
  const [contacts, setContacts] = useState<Aircraft[]>(aircraft);
  // Police-only by default; toggle in-overlay to also show civil flights.
  const [showCivil, setShowCivil] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState(false); // manual cycle mode (no aiming)
  const [view, setView] = useState<ViewModel>({
    azimuth: null,
    elevation: 0,
    projected: [],
    ground: [],
    targetHex: null,
    locked: false,
    dwellHex: null,
    dwellProgress: 0,
    dwellMode: "lock",
    aimHint: null,
    contactCount: 0,
    manualIdx: 0,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Live inputs read by the rAF engine without forcing re-renders.
  const rawRef = useRef<{ a: number; b: number; g: number } | null>(null);
  const screenAngleRef = useRef(0);
  const basisRef = useRef<CamBasis | null>(null);
  const contactsRef = useRef<Aircraft[]>(aircraft);
  const showCivilRef = useRef(false); // mirror of `showCivil` for the rAF loop
  const reportsRef = useRef<Report[]>(reports);
  const userLocRef = useRef(userLocation);
  // Lock + dwell state (mutated in the loop; tap handlers can override).
  const lockedRef = useRef<string | null>(null);
  const dwellRef = useRef<{ hex: string | null; since: number }>({ hex: null, since: 0 });
  const breakRef = useRef<number>(0); // timestamp the crosshair left the locked target
  const manualRef = useRef(false); // mirror of `manual` for the rAF loop
  const manualIdxRef = useRef(0); // selected index into the distance-sorted list
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  useEffect(() => { reportsRef.current = reports; }, [reports]);
  useEffect(() => { userLocRef.current = userLocation; }, [userLocation]);
  useEffect(() => { manualRef.current = manual; }, [manual]);
  useEffect(() => { showCivilRef.current = showCivil; }, [showCivil]);

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

  // ── Raw device orientation capture (no React state per event) ─────────────
  // Sensor events fire ~60×/s and are noisy; we only stash the latest raw angles
  // in a ref here. The rAF engine below smooths them and drives all rendering,
  // which is what kills the jitter and keeps reticles glued to your aim.
  useEffect(() => {
    let active = true;
    let gotAbsolute = false;

    const stash = (e: DeviceOrientationEvent, absolute: boolean) => {
      if (!active || e.alpha == null || e.beta == null || e.gamma == null) return;
      const anyE = e as any;
      // iOS reports a true compass heading directly; convert it into an
      // equivalent absolute alpha so the shared rotation math can consume it.
      const alpha = typeof anyE.webkitCompassHeading === "number"
        ? (360 - anyE.webkitCompassHeading) % 360
        : e.alpha;
      rawRef.current = { a: alpha, b: e.beta, g: e.gamma };
      void absolute;
    };
    const handleAbsolute = (e: DeviceOrientationEvent) => { gotAbsolute = true; stash(e, true); };
    const handleRelative = (e: DeviceOrientationEvent) => { if (!gotAbsolute) stash(e, false); };

    const readScreenAngle = () => {
      const a = (screen.orientation && screen.orientation.angle) ?? (window as any).orientation ?? 0;
      screenAngleRef.current = typeof a === "number" ? a : 0;
    };
    readScreenAngle();

    const start = () => {
      window.addEventListener("deviceorientationabsolute", handleAbsolute as any, true);
      window.addEventListener("deviceorientation", handleRelative, true);
      window.addEventListener("orientationchange", readScreenAngle);
    };

    const anyDOE = DeviceOrientationEvent as any;
    if (typeof anyDOE?.requestPermission === "function") {
      anyDOE.requestPermission().then((res: string) => { if (res === "granted") start(); }).catch(() => {});
    } else {
      start();
    }
    return () => {
      active = false;
      window.removeEventListener("deviceorientationabsolute", handleAbsolute as any, true);
      window.removeEventListener("deviceorientation", handleRelative, true);
      window.removeEventListener("orientationchange", readScreenAngle);
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

  // ── rAF engine: smooth orientation → project reticles → run dwell-lock ─────
  // One animation-frame loop owns all motion so the display is fluid and stable,
  // decoupled from the noisy ~60Hz sensor stream and the 3s data poll.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const loc = userLocRef.current;
      // Police-only unless the user toggles civil flights on.
      const cs = showCivilRef.current
        ? contactsRef.current
        : contactsRef.current.filter(isLawEnforcement);
      const now = performance.now();

      // 1) Smooth the camera basis toward the latest raw orientation.
      let basis: CamBasis | null = null;
      let azimuth: number | null = null;
      let elevation = 0;
      if (rawRef.current) {
        const { a, b, g } = rawRef.current;
        const targetBasis = cameraBasis(a, b, g, screenAngleRef.current, HEADING_CALIBRATION_DEG);
        basisRef.current = basisRef.current
          ? smoothBasis(basisRef.current, targetBasis, SMOOTHING)
          : targetBasis;
        basis = basisRef.current;
        const ae = azElOf(basis.fwd);
        azimuth = ae.azimuth;
        elevation = ae.elevation;
      }

      // 2) Project every contact through the smoothed basis (or fallback spread).
      const total = cs.length;
      const projected: Projected[] = !loc
        ? []
        : cs.map((ac, i): Projected => {
            const distM = haversineM(loc.lat, loc.lng, ac.latitude, ac.longitude);
            const altM = (ac.altitude ?? 0) * 0.3048;
            const elevDeg = distM > 0 ? toDeg(Math.atan2(altM, distM)) : 90;
            const bearing = bearingDeg(loc.lat, loc.lng, ac.latitude, ac.longitude);
            const isLE = ac.category !== "civil";
            let xPct: number, yPct: number, onScreen: boolean;
            if (basis) {
              const pr = projectDir(dirFromAzEl(bearing, elevDeg), basis, HFOV, VFOV);
              // Mirror per-axis if the device tracks backwards (see YAW_DIR/PITCH_DIR).
              xPct = 50 + YAW_DIR * (pr.xPct - 50);
              yPct = 50 + PITCH_DIR * (pr.yPct - 50);
              onScreen = pr.onScreen;
            } else {
              const spread = 64;
              xPct = total > 1 ? 50 - spread / 2 + (i / (total - 1)) * spread : 50;
              yPct = 22 + (i % 4) * 9;
              onScreen = true;
            }
            const centreDist = Math.hypot(xPct - 50, yPct - 50);
            return { ac, xPct, yPct, onScreen, distM, elevDeg, centreDist, isLE, bearing };
          });

      // 2b) Project ground units onto the horizon at their GPS bearing. Unlike
      // aircraft they have no useful altitude, so we pin elevation to 0° — they
      // surface as you tilt down toward street level. Nearest first, capped so a
      // busy feed can't flood the view.
      const rs = reportsRef.current;
      const ground: ProjectedGround[] = !loc
        ? []
        : [...rs]
            .map((r): ProjectedGround => {
              const distM = haversineM(loc.lat, loc.lng, r.lat, r.lng);
              const bearing = bearingDeg(loc.lat, loc.lng, r.lat, r.lng);
              let xPct: number, yPct: number, onScreen: boolean;
              if (basis) {
                const pr = projectDir(dirFromAzEl(bearing, 0), basis, HFOV, VFOV);
                xPct = 50 + YAW_DIR * (pr.xPct - 50);
                yPct = 50 + PITCH_DIR * (pr.yPct - 50);
                onScreen = pr.onScreen;
              } else {
                xPct = 50;
                yPct = 82; // fallback: line them up low, near street level
                onScreen = true;
              }
              return { r, xPct, yPct, onScreen, distM, bearing };
            })
            .sort((a, b) => a.distM - b.distM);
      // Fallback (no compass) spread along the bottom so labels don't stack.
      if (!basis && ground.length > 1) {
        const spread = 70;
        ground.forEach((g, i) => {
          g.xPct = 50 - spread / 2 + (i / (ground.length - 1)) * spread;
        });
      }

      // 3) Nearest contact under the crosshair.
      const nearest = projected
        .filter((p) => p.onScreen && p.centreDist <= LOCK_RADIUS_PCT)
        .sort((a, b) => a.centreDist - b.centreDist)[0] ?? null;

      // 4) Target selection.
      let dwellHex: string | null = null;
      let dwellProgress = 0;
      let dwellMode: "lock" | "break" = "lock";
      let targetHex: string | null = null;
      let manualIdx = 0;

      // Distance-sorted list (nearest first) for manual cycling.
      const ordered = [...projected].sort((a, b) => a.distM - b.distM);

      if (manualRef.current) {
        // Manual cycle mode: aiming is irrelevant — pick by index, nearest first.
        if (ordered.length) {
          const idx = ((manualIdxRef.current % ordered.length) + ordered.length) % ordered.length;
          manualIdxRef.current = idx;
          manualIdx = idx;
          targetHex = ordered[idx].ac.hex;
        }
      } else {
        // Auto dwell-lock: acquire by holding the crosshair on a contact, release
        // by holding it off the locked one.
        const locked = lockedRef.current;
        if (!locked) {
          const nh = nearest?.ac.hex ?? null;
          if (nh && dwellRef.current.hex === nh) {
            dwellProgress = Math.min(1, (now - dwellRef.current.since) / LOCK_DWELL_MS);
            if (dwellProgress >= 1) {
              lockedRef.current = nh;
              dwellRef.current = { hex: null, since: now };
            }
          } else {
            dwellRef.current = { hex: nh, since: now };
          }
          dwellHex = nh;
          dwellMode = "lock";
        } else {
          const lp = projected.find((p) => p.ac.hex === locked);
          const onTarget = !!lp && lp.onScreen && lp.centreDist <= LOCK_RADIUS_PCT;
          if (onTarget) {
            breakRef.current = 0;
          } else {
            if (breakRef.current === 0) breakRef.current = now;
            dwellProgress = Math.min(1, (now - breakRef.current) / BREAK_DWELL_MS);
            if (dwellProgress >= 1) {
              lockedRef.current = null;
              breakRef.current = 0;
            }
          }
          dwellHex = locked;
          dwellMode = "break";
        }
        targetHex = lockedRef.current ?? (nearest ? nearest.ac.hex : null);
      }

      // 5) Aim hint: which way to turn/tilt to bring the selected target on-screen.
      let aimHint: string | null = null;
      const sel = targetHex ? projected.find((p) => p.ac.hex === targetHex) : null;
      if (sel) {
        if (sel.onScreen) {
          aimHint = "● IN VIEW";
        } else {
          const lr = sel.xPct < 0 ? "◀ LEFT" : sel.xPct > 100 ? "RIGHT ▶" : "";
          const ud = sel.yPct < 0 ? "▲ UP" : sel.yPct > 100 ? "▼ DOWN" : "";
          aimHint = [lr, ud].filter(Boolean).join("  ") || "● IN VIEW";
        }
      }

      setView({
        azimuth,
        elevation,
        projected,
        ground,
        targetHex,
        locked: manualRef.current ? targetHex != null : lockedRef.current != null,
        dwellHex,
        dwellProgress,
        dwellMode,
        aimHint,
        contactCount: ordered.length,
        manualIdx,
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const projected = view.projected;
  const target = view.targetHex ? projected.find((p) => p.ac.hex === view.targetHex) ?? null : null;
  const setLocked = useCallback((hex: string | null) => {
    lockedRef.current = hex;
    breakRef.current = 0;
    dwellRef.current = { hex: null, since: performance.now() };
  }, []);
  // Step through contacts (nearest first) in manual cycle mode.
  const cycle = useCallback((dir: number) => { manualIdxRef.current += dir; }, []);

  const handlePing = useCallback(async () => {
    if (!userLocation) {
      alert("GPS location required for PING SKY. Enable location access.");
      return;
    }
    try {
      await fetch("/api/sighting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aircraftHex: target?.ac.hex ?? "UNKNOWN",
          observerLat: userLocation.lat,
          observerLng: userLocation.lng,
          bearingDeg: view.azimuth ?? 0,
          elevationDeg: view.elevation ?? 45,
          sessionId: getSessionId(),
        }),
      });
    } catch {
      /* offline — still confirm */
    }
    setPingCount((c) => c + 1);
    setPinged(true);
  }, [userLocation, view.azimuth, view.elevation, target]);

  return (
    <div
      className="vp-ar-overlay"
      role="dialog"
      aria-label="AR Camera Overlay"
      onClick={() => setLocked(null)}
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
        {view.azimuth != null ? `${Math.round(view.azimuth)}° ${compassDir(view.azimuth)}` : "NO COMPASS"}
        {"  ·  "}
        {projected.filter((p) => p.onScreen).length}/{projected.length} {showCivil ? "AIR" : "LE AIR"}
        {view.ground.length > 0 && (
          <span style={{ color: GROUND, marginLeft: 8 }}>
            ◆ {view.ground.filter((g) => g.onScreen).length}/{view.ground.length} GND
          </span>
        )}
        {view.locked && <span style={{ color: AMBER, marginLeft: 8 }}>● LOCK</span>}
      </div>

      {/* Civil-flights toggle — police-only by default; tap to also show civil */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowCivil((v) => !v); }}
        aria-pressed={showCivil}
        style={{
          position: "absolute", top: 34, left: 12, zIndex: 8,
          fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
          padding: "5px 10px", borderRadius: 14, cursor: "pointer",
          background: showCivil ? "rgba(34,211,238,0.16)" : "rgba(255,255,255,0.06)",
          border: `1px solid ${showCivil ? CYAN : "rgba(255,255,255,0.3)"}`,
          color: showCivil ? CYAN : "rgba(255,255,255,0.7)",
        }}
      >
        {showCivil ? "CIVIL ✓" : "CIVIL ✕"}
      </button>

      {/* Crosshair */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 60, height: 60, pointerEvents: "none" }}>
        <div style={{ position: "absolute", width: 1, height: "100%", left: "50%", background: "rgba(255,255,255,0.25)" }} />
        <div style={{ position: "absolute", height: 1, width: "100%", top: "50%", background: "rgba(255,255,255,0.25)" }} />
      </div>

      {/* Aircraft reticles */}
      {projected.map((p) => {
        if (!p.onScreen) return null;
        const color = p.isLE ? AMBER : CYAN;
        const isTarget = view.targetHex === p.ac.hex;
        const isLocked = view.locked && isTarget;
        // Dwell ring: fraction filled while a lock is acquiring (or a break is
        // counting down) on this contact.
        const showDwell = view.dwellHex === p.ac.hex && view.dwellProgress > 0.01;
        const ringColor = view.dwellMode === "break" ? "#ff5c5c" : color;
        const sz = isTarget ? 30 : 20;
        return (
          <div
            key={p.ac.id}
            onClick={(e) => {
              e.stopPropagation();
              setLocked(p.ac.hex); // tap = instant lock override
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
                position: "relative",
                width: sz,
                height: sz,
                borderRadius: "50%",
                border: `2px ${isLocked ? "solid" : "solid"} ${color}`,
                boxShadow: isTarget ? `0 0 14px ${color}` : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "width 120ms ease, height 120ms ease, box-shadow 120ms ease",
              }}
            >
              {showDwell && (
                <div
                  style={{
                    position: "absolute",
                    inset: -5,
                    borderRadius: "50%",
                    background: `conic-gradient(${ringColor} ${view.dwellProgress * 360}deg, transparent 0deg)`,
                    WebkitMask: "radial-gradient(transparent 58%, #000 60%)",
                    mask: "radial-gradient(transparent 58%, #000 60%)",
                  }}
                />
              )}
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: color }} />
              {isLocked && (
                <div style={{ position: "absolute", inset: -9, borderRadius: "50%", border: `1px solid ${color}`, opacity: 0.5 }} />
              )}
            </div>
            {!isTarget && (
              <div style={{ marginTop: 3, fontFamily: "'Space Mono', monospace", fontSize: 9, color, whiteSpace: "nowrap", textShadow: "0 1px 2px #000", letterSpacing: "0.05em" }}>
                {p.ac.callsign || p.ac.hex}
              </div>
            )}
            {isLocked && (
              <div style={{ marginTop: 3, fontFamily: "'Space Mono', monospace", fontSize: 8, color, whiteSpace: "nowrap", textShadow: "0 1px 2px #000", letterSpacing: "0.1em", textAlign: "center" }}>
                {view.dwellMode === "break" && view.dwellProgress > 0.01 ? "RELEASING…" : "LOCKED"}
              </div>
            )}
          </div>
        );
      })}

      {/* Ground-unit reticles — distinct red diamonds on the horizon, each
          tagged with its kind and the straight-line distance from the user. */}
      {view.ground.map((g) => {
        if (!g.onScreen) return null;
        return (
          <div
            key={g.r.id}
            style={{
              position: "absolute",
              left: `${g.xPct}%`,
              top: `${g.yPct}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: 4,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* Diamond reticle (rotated square) — shape-distinct from sky circles */}
            <div
              style={{
                width: 16,
                height: 16,
                transform: "rotate(45deg)",
                border: `2px solid ${GROUND}`,
                background: `${GROUND}22`,
                boxShadow: `0 0 10px ${GROUND}99`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: 3, height: 3, background: GROUND, transform: "rotate(-45deg)" }} />
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "'Space Mono', monospace",
                fontSize: 9,
                fontWeight: 700,
                color: GROUND,
                whiteSpace: "nowrap",
                textShadow: "0 1px 2px #000",
                letterSpacing: "0.08em",
              }}
            >
              {groundLabel(g.r)} · {fmtDist(g.distM)}
            </div>
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

      {/* Aim hint (which way the selected target is, when off-screen) */}
      {view.aimHint && (
        <div style={{ position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)", fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, letterSpacing: "0.18em", color: view.aimHint === "● IN VIEW" ? "#9effa0" : AMBER, textShadow: "0 1px 4px #000", pointerEvents: "none" }}>
          {view.aimHint}
        </div>
      )}

      {/* Mode toggle: FREE AIM (point the phone) ⇄ MANUAL (cycle contacts) */}
      <button
        onClick={(e) => { e.stopPropagation(); setManual((m) => !m); }}
        style={{
          position: "absolute", bottom: 140, left: "50%", transform: "translateX(-50%)",
          fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
          padding: "6px 12px", borderRadius: 14, cursor: "pointer",
          background: manual ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.06)",
          border: `1px solid ${manual ? CYAN : "rgba(255,255,255,0.3)"}`,
          color: manual ? CYAN : "rgba(255,255,255,0.7)",
        }}
      >
        {manual ? "◀▶ MANUAL CYCLE" : "✛ FREE AIM"} — TAP TO SWITCH
      </button>

      {/* Bottom controls — differ by mode */}
      <div style={{ position: "absolute", bottom: 96, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 10, alignItems: "center", pointerEvents: "auto" }}>
        {manual ? (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); cycle(-1); }}
              disabled={view.contactCount === 0}
              style={cycleBtnStyle(view.contactCount > 0, CYAN)}
            >
              ◀ PREV
            </button>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.7)", minWidth: 52, textAlign: "center", letterSpacing: "0.08em" }}>
              {view.contactCount ? `${view.manualIdx + 1}/${view.contactCount}` : "—"}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); cycle(1); }}
              disabled={view.contactCount === 0}
              style={cycleBtnStyle(view.contactCount > 0, CYAN)}
            >
              NEXT ▶
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); if (view.targetHex) setLocked(view.targetHex); }}
              disabled={!view.targetHex || view.locked}
              style={cycleBtnStyle(!!view.targetHex && !view.locked, AMBER)}
            >
              ◎ LOCK ON TARGET
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setLocked(null); }}
              disabled={!view.locked}
              style={cycleBtnStyle(view.locked, "#ff5c5c")}
            >
              ✕ DISENGAGE LOCK
            </button>
          </>
        )}
      </div>

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

// Shared style for the bottom control buttons.
function cycleBtnStyle(active: boolean, color: string): CSSProperties {
  return {
    fontFamily: "'Space Mono', monospace",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    padding: "8px 14px",
    borderRadius: 6,
    cursor: active ? "pointer" : "default",
    background: active ? `${color}26` : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? color : "rgba(255,255,255,0.2)"}`,
    color: active ? color : "rgba(255,255,255,0.3)",
  };
}

// ── Detail box ───────────────────────────────────────────────────────────────
function InfoBox({ p }: { p: Projected }) {
  const { ac } = p;
  const color = p.isLE ? AMBER : CYAN;
  // Place the box beside the reticle, flipping to the left near the right edge
  // and clamping so it stays on screen even when the target is off-frame (manual
  // mode selects contacts that may be behind/beside you).
  const cx = Math.min(Math.max(p.xPct, 12), 88);
  const cy = Math.min(Math.max(p.yPct, 14), 74);
  const onRight = cx > 60;
  const left = onRight ? undefined : `calc(${Math.min(cx, 70)}% + 26px)`;
  const right = onRight ? `calc(${100 - Math.max(cx, 30)}% + 26px)` : undefined;
  const top = `${cy}%`;

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

      {/* Compass-independent "where to look" — straight from GPS positions, so
          it's reliable even if the phone magnetometer is off. */}
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.05em", marginBottom: 5, padding: "3px 5px", background: `${color}1a`, borderRadius: 3 }}>
        ↗ LOOK {Math.round(p.bearing)}° {compassDir(p.bearing)} · {p.elevDeg >= 0 ? "+" : ""}{Math.round(p.elevDeg)}° UP
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
