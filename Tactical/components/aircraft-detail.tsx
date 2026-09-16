"use client";

/**
 * VP·OVERWATCH — AircraftDetail panel (v3)
 * ─────────────────────────────────────────────────────────────────────────
 * Absolute right-side panel (desktop) / draggable bottom sheet (mobile — opens
 * at the smallest of MOBILE_SNAPS and resizes on a swipe of the grip or header;
 * its top edge is published as --vp-panel-h so the FAB cluster clears it).
 * Adds: a real photo of the selected tail (planespotters.net, via
 * /api/aircraft/photo, with mandatory attribution), a per-type airframe spec
 * block, and richer live telemetry (range/bearing from the user, vertical
 * state, position, estimated return).
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Aircraft, User } from "@/lib/data";
import { computeDistance, isSilentContact } from "@/lib/data";

interface AircraftDetailProps {
  aircraft: Aircraft;
  onClose: () => void;
  /** Viewer position — enables range/bearing readout. Optional. */
  user?: User;
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

// ── Static per-type airframe reference (the "more info" beyond live telemetry).
// Keyed by the ADS-B type code; falls back to a rotary/fixed-wing generic.
interface Spec {
  name: string;
  maker: string;
  cls: string;
  powerplant: string;
  role: string;
  art: "heli" | "plane";
}
const TYPE_SPECS: Record<string, Spec> = {
  A139: { name: "AgustaWestland AW139", maker: "Leonardo", cls: "Twin-engine medium helicopter", powerplant: "2× P&WC PT6C-67C turboshaft", role: "Air support · surveillance · SAR/hoist", art: "heli" },
  AW139: { name: "AgustaWestland AW139", maker: "Leonardo", cls: "Twin-engine medium helicopter", powerplant: "2× P&WC PT6C-67C turboshaft", role: "Air support · surveillance · SAR/hoist", art: "heli" },
  EC135: { name: "Eurocopter EC135", maker: "Airbus Helicopters", cls: "Twin-engine light helicopter", powerplant: "2× Turbomeca Arrius 2B", role: "Police · EMS · observation", art: "heli" },
  B350: { name: "Beechcraft King Air 350ER", maker: "Textron / Beechcraft", cls: "Twin-turboprop, extended range", powerplant: "2× P&WC PT6A-60A", role: "ISR · surveillance · transport", art: "plane" },
  C208: { name: "Cessna 208 Caravan", maker: "Cessna / Textron", cls: "Single-turboprop utility", powerplant: "1× P&WC PT6A-114A", role: "Surveillance · utility", art: "plane" },
};
function specFor(ac: Aircraft): Spec {
  const t = (ac.type || "").toUpperCase();
  if (TYPE_SPECS[t]) return TYPE_SPECS[t];
  const heli = ac.role === "rotary";
  return {
    name: ac.typeLabel || ac.type || (heli ? "Helicopter" : "Aircraft"),
    maker: ac.operator || "—",
    cls: heli ? "Rotary-wing aircraft" : "Fixed-wing aircraft",
    powerplant: "—",
    role: "Air support",
    art: heli ? "heli" : "plane",
  };
}

// ── Simple cyan line-art fallbacks (shown until/if no photo is available). ──
function Silhouette({ art }: { art: "heli" | "plane" }) {
  const common = { fill: "none", stroke: "var(--vp-cyan, #00d4ff)", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, opacity: 0.55 };
  return (
    <svg viewBox="0 0 200 120" width="60%" height="60%" aria-hidden>
      {art === "heli" ? (
        <g {...common}>
          <line x1="30" y1="42" x2="170" y2="42" />
          <line x1="100" y1="42" x2="100" y2="52" />
          <ellipse cx="92" cy="70" rx="46" ry="18" />
          <path d="M138 70 L182 62" />
          <circle cx="182" cy="62" r="7" />
          <line x1="70" y1="88" x2="120" y2="88" />
          <line x1="78" y1="88" x2="72" y2="96" />
          <line x1="112" y1="88" x2="118" y2="96" />
        </g>
      ) : (
        <g {...common}>
          <path d="M40 60 Q100 50 168 60 Q100 70 40 60 Z" />
          <path d="M96 58 L70 30 L84 58" />
          <path d="M96 62 L70 90 L84 62" />
          <path d="M160 60 L176 48 L172 60" />
          <path d="M160 60 L176 72 L172 60" />
        </g>
      )}
    </svg>
  );
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function cardinal(deg: number): string {
  return CARDINALS[Math.round(deg / 45) % 8];
}

interface Photo { src: string | null; link?: string; photographer?: string }

// Hero photo of the actual tail (planespotters via our cached proxy). Falls
// back to a line-art silhouette. Attribution is mandatory when a photo shows.
function AircraftPhoto({ ac, spec }: { ac: Aircraft; spec: Spec }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  const reqKey = useRef<string>("");

  useEffect(() => {
    const key = ac.hex || ac.registration;
    reqKey.current = key;
    setLoading(true);
    setPhoto(null);
    const params = new URLSearchParams();
    if (ac.registration) params.set("reg", ac.registration);
    if (ac.hex) params.set("hex", ac.hex);
    fetch(`/api/aircraft/photo?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Photo) => { if (reqKey.current === key) { setPhoto(d); setLoading(false); } })
      .catch(() => { if (reqKey.current === key) { setPhoto(null); setLoading(false); } });
  }, [ac.hex, ac.registration]);

  const hasPhoto = !!photo?.src;

  return (
    <div
      style={{
        // Explicit height + no-shrink: an aspect-ratio box collapses to ~0 as a
        // flex item in this column-flex panel, so fix the height instead.
        position: "relative", width: "100%", height: 172, flexShrink: 0,
        background: "radial-gradient(120% 120% at 50% 30%, rgba(45,140,255,0.06), rgba(0,0,0,0.35))",
        borderTop: "1px solid rgba(255,255,255,0.08)", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo!.src!}
          alt={`${ac.registration || ac.callsign} — ${spec.name}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <>
          <Silhouette art={spec.art} />
          <span style={{ position: "absolute", bottom: 6, left: 8, fontSize: 8, letterSpacing: "0.14em", color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-mono, monospace)" }}>
            {loading ? "LOADING PHOTO…" : "NO PHOTO ON FILE"}
          </span>
        </>
      )}

      {/* type tag, top-left */}
      <span style={{ position: "absolute", top: 6, left: 8, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "var(--vp-cyan, #00d4ff)", background: "rgba(0,0,0,0.45)", padding: "2px 6px", borderRadius: 3, fontFamily: "var(--font-mono, monospace)" }}>
        {ac.type || spec.name}
      </span>

      {/* mandatory attribution when a photo is shown */}
      {hasPhoto && (
        <a
          href={photo!.link || "https://www.planespotters.net/"}
          target="_blank" rel="noopener noreferrer"
          style={{
            position: "absolute", right: 0, bottom: 0, maxWidth: "100%",
            fontSize: 8, letterSpacing: "0.06em", color: "rgba(255,255,255,0.7)",
            background: "linear-gradient(90deg, transparent, rgba(0,0,0,0.6) 30%)",
            padding: "3px 6px 3px 18px", textDecoration: "none",
            fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
          }}
          title={`Photo © ${photo!.photographer || "unknown"} — planespotters.net`}
        >
          © {photo!.photographer || "unknown"} · planespotters
        </a>
      )}
    </div>
  );
}

function Row({ k, v, cls, dim }: { k: string; v: React.ReactNode; cls?: string; dim?: boolean }) {
  return (
    <div className="vp-panel-row">
      <span className="vp-panel-key">{k}</span>
      <span className={`vp-panel-val ${cls || ""}`} style={dim ? { fontSize: 10, color: "rgba(255,255,255,0.45)" } : undefined}>
        {v}
      </span>
    </div>
  );
}

/**
 * Mobile snap points, as a fraction of the sheet's container height, smallest
 * first. The sheet opens at [0]: the panel used to be a fixed 60% of the map
 * area, which covered the aircraft you just tapped to look at.
 */
const MOBILE_SNAPS = [0.32, 0.55, 0.88];
const DRAG_MIN_F = 0.2;
const DRAG_MAX_F = 0.92;

export function AircraftDetail({ aircraft: ac, onClose, user }: AircraftDetailProps) {
  const isLanded = ac.landed === true;
  const isLost = isSilentContact(ac);
  const isSilent = ac.isActive === true && (ac.isModeS === true || ac.isMlat === true);

  const spec = specFor(ac);
  const fuelPct = ac.fuelRemainingPercent ?? 100;
  const fl = fuelLevel(fuelPct);
  const endMin = ac.fuelEnduranceMinutes ?? 240;
  const remainMin = Math.round((fuelPct / 100) * endMin);
  const airtimeMin = Math.round((ac.timeAirborneSeconds ?? 0) / 60);
  const lastTp = ac.track && ac.track.length ? ac.track[ac.track.length - 1] : null;
  const vs = lastTp ? lastTp.vs : null;
  const vState = vs == null ? null : vs > 100 ? "CLIMB" : vs < -100 ? "DESCEND" : "LEVEL";
  const etaMin = ac.estimatedReturnSeconds ? Math.round(ac.estimatedReturnSeconds / 60) : 0;

  // ── Mobile bottom-sheet behaviour ────────────────────────────────────────
  // On the mobile layout this panel is a bottom sheet: it opens at the smallest
  // snap and resizes when the operator swipes its grip or header up/down.
  // Desktop is untouched — there it stays a fixed right-hand column.
  const panelRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [snapIdx, setSnapIdx] = useState(0);
  const [sheetH, setSheetH] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  // Mirrors sheetH so the pointer handlers never read a stale render value.
  const heightRef = useRef(0);

  const containerH = () =>
    panelRef.current?.parentElement?.clientHeight || window.innerHeight;

  // page.tsx switches layouts at window.innerWidth >= 900 — match it exactly so
  // the sheet never applies to the desktop column.
  useEffect(() => {
    const apply = () => setIsMobile(window.innerWidth < 900);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // Size the sheet, and publish its top edge as --vp-panel-h so the FAB cluster
  // (which sits above the sheet on mobile) keeps clearing it at every snap.
  useEffect(() => {
    const root = document.documentElement;
    if (!isMobile) {
      setSheetH(null);
      root.style.removeProperty("--vp-panel-h");
      return;
    }
    const apply = () => {
      const h = Math.round(containerH() * MOBILE_SNAPS[snapIdx]);
      heightRef.current = h;
      setSheetH(h);
      root.style.setProperty("--vp-panel-h", `${h}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--vp-panel-h");
    };
  }, [isMobile, snapIdx]);

  const onDragStart = (e: ReactPointerEvent<HTMLElement>) => {
    if (!isMobile) return;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    dragRef.current = {
      startY: e.clientY,
      startH: heightRef.current || containerH() * MOBILE_SNAPS[snapIdx],
    };
    setDragging(true);
  };

  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const ch = containerH();
    // Dragging up (smaller clientY) grows the sheet.
    const next = Math.min(
      Math.max(d.startH + (d.startY - e.clientY), ch * DRAG_MIN_F),
      ch * DRAG_MAX_F,
    );
    heightRef.current = next;
    setSheetH(next);
  };

  const onDragEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    const ch = containerH();
    let best = 0;
    let bestDist = Infinity;
    MOBILE_SNAPS.forEach((f, i) => {
      const dist = Math.abs(ch * f - heightRef.current);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    const h = Math.round(ch * MOBILE_SNAPS[best]);
    heightRef.current = h;
    setSheetH(h);
    setSnapIdx(best);
  };

  // Range / bearing from the viewer, if we have both fixes.
  let range: string | null = null;
  let brg: string | null = null;
  if (user && ac.latitude && ac.longitude && !(ac.latitude === 0 && ac.longitude === 0)) {
    const m = computeDistance(user.lat, user.lng, ac.latitude, ac.longitude);
    range = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
    const b = bearingDeg(user.lat, user.lng, ac.latitude, ac.longitude);
    brg = `${Math.round(b)}° ${cardinal(b)}`;
  }

  return (
    <div
      ref={panelRef}
      className={`vp-detail-panel ${isLost ? "vp-lost" : ""} ${dragging ? "is-dragging" : ""}`}
      style={
        isMobile && sheetH != null
          ? {
              height: `${sheetH}px`,
              // No transition while the finger is down, or the sheet lags it.
              transition: dragging ? "none" : "height 220ms cubic-bezier(0.32,0.72,0,1)",
            }
          : undefined
      }
    >
      {/* Mobile grab handle — the affordance for the swipe */}
      {isMobile && (
        <div
          className="vp-sheet-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize panel"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />
      )}

      {/* Header (draggable on mobile too, so the whole top strip is a target) */}
      <div
        className="vp-panel-header"
        onPointerDown={isMobile ? onDragStart : undefined}
        onPointerMove={isMobile ? onDragMove : undefined}
        onPointerUp={isMobile ? onDragEnd : undefined}
        onPointerCancel={isMobile ? onDragEnd : undefined}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="vp-panel-callsign">{ac.callsign || ac.registration || ac.hex}</div>
            <div className="vp-panel-type">{spec.name} · {ac.operator || "VicPol Air Wing"}</div>
          </div>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 4, marginTop: -2 }}
            aria-label="Close panel"
          >
            <XIcon />
          </button>
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`vp-badge ${getSourceClass(ac)}`}>{getSourceText(ac)}</span>
          {isSilent && <span className="vp-badge silent">SILENT</span>}
          {isLost && <span className="vp-badge lost">LOST</span>}
          {isLanded && <span className="vp-badge landed">LANDED</span>}
        </div>
      </div>

      {/* Lost signal banner */}
      {isLost && (
        <div className="vp-lost-banner">
          <span>⚠</span> LOST SIGNAL — AIRBORNE {airtimeMin}min
        </div>
      )}

      {/* Live telemetry */}
      <Row k="ALTITUDE" v={ac.altitude != null ? `${ac.altitude.toLocaleString()} ft` : "—"} cls="cyan" />
      <Row k="SPEED" v={ac.speed != null ? `${ac.speed} kts` : "—"} />
      <Row k="HEADING" v={ac.heading != null ? `${ac.heading}° ${cardinal(ac.heading)}` : "—"} />
      <Row
        k="VERTICAL"
        v={vs == null ? "—" : (
          <span style={{ color: vState === "CLIMB" ? "var(--vp-cyan,#00d4ff)" : vState === "DESCEND" ? "var(--vp-amber,#ffaa00)" : undefined }}>
            {vState === "CLIMB" ? "▲ " : vState === "DESCEND" ? "▼ " : "• "}
            {vs > 0 ? "+" : ""}{vs} fpm
          </span>
        )}
      />
      {range && <Row k="RANGE" v={range} />}
      {brg && <Row k="BEARING" v={brg} />}
      <Row k="AIRBORNE" v={airtimeMin > 0 ? `${airtimeMin} min` : "—"} cls="amber" />
      {etaMin > 0 && etaMin < 360 && <Row k="EST. RETURN" v={`~${etaMin} min`} />}
      {ac.latitude && ac.longitude && !(ac.latitude === 0 && ac.longitude === 0) && (
        <Row k="POSITION" v={`${ac.latitude.toFixed(4)}, ${ac.longitude.toFixed(4)}`} dim />
      )}
      <Row k="REGO" v={ac.registration || "—"} />
      <Row k="ICAO" v={ac.hex} dim />

      {/* Fuel bar */}
      <div className="vp-fuel-wrap">
        <div className="vp-fuel-label">
          <span className="vp-panel-key">FUEL EST.</span>
          <span
            className="vp-panel-val"
            style={{ fontSize: 10, color: fl === "low" ? "var(--vp-red)" : fl === "medium" ? "var(--vp-amber)" : "var(--vp-cyan)" }}
          >
            {Math.round(fuelPct)}% · ~{remainMin}min
          </span>
        </div>
        <div className="vp-fuel-track">
          <div className={`vp-fuel-fill ${fl}`} style={{ width: `${fuelPct}%` }} />
        </div>
      </div>

      {/* Airframe reference (static per type) */}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="vp-panel-key" style={{ marginBottom: 6, opacity: 0.7 }}>AIRFRAME</div>
        <Row k="CLASS" v={spec.cls} dim />
        <Row k="MAKER" v={spec.maker} dim />
        <Row k="POWERPLANT" v={spec.powerplant} dim />
        <Row k="ROLE" v={spec.role} dim />
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

      {/* Photo of the actual tail — at the bottom, below all the readouts */}
      <div style={{ marginTop: 14 }}>
        <AircraftPhoto ac={ac} spec={spec} />
      </div>
    </div>
  );
}
