"use client";

/**
 * VP·OVERWATCH — operational header
 * ─────────────────────────────────────────────────────────────────────────
 * Professional operations-dashboard header: brand block, then compact status
 * groups (LIVE STATUS / AIRCRAFT / GROUND / LAST UPDATE) in the visual language
 * of the VP·OVERWATCH badge — navy foundation, steel dividers, restrained blue
 * for live aircraft information.
 *
 * Semantic colours come from globals.css and are NOT restyled here: amber
 * carries MLAT/silent and fuel-overrun, red carries lost signal and threats.
 * Blue is used for information, never for everything.
 *
 * Usage in page.tsx:
 *   import { VPHeader } from "@/components/vp-header";
 *   <VPHeader
 *     airCount={filteredAircraft.length}
 *     gndCount={allGroundContacts.length}
 *     silentCount={silentCount}
 *     isLostSignal={isLostSignal}
 *     isConnected={isOnline}
 *     lastUpdate={liveData.lastUpdate}
 *     onSubscribeClick={() => setShowSubscribe(true)}
 *   />
 *
 * Requires vp-theme.css to be imported in layout.tsx.
 */

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { PwaInstall } from "@/components/pwa-install";
import { formatDataAge, GROUND_STALE_AFTER_SEC } from "@/lib/data";

interface VPHeaderProps {
  airCount: number;
  gndCount: number;
  silentCount: number;
  isLostSignal: boolean;
  isConnected: boolean;
  /** Epoch ms of the last successful data refresh (useRealtimeData.lastUpdate) */
  lastUpdate: number;
  /**
   * Age in seconds of the newest GROUND ingest (relay.secondsSinceLastIngest).
   *
   * Surfaced because an empty ground layer has two very different meanings: with
   * a fresh feed there is genuinely nothing to draw, and with a stale one the
   * data stopped arriving. Without this the header cannot tell an operator which
   * one they are looking at. 9999 = never ingested.
   */
  groundAgeSec?: number;
  onSubscribeClick: () => void;
  /**
   * Fly the map to the closest aircraft. The Aircraft tile is the natural place for it:
   * the tile already reports how many are tracked, so tapping it to go to the nearest one
   * is the obvious reading of the control.
   */
  onNearestAircraft?: () => void;
  /** Fly the map to the closest ground contact — the same behaviour on the GROUND tile. */
  onNearestGround?: () => void;
}

/** Melbourne wall clock. */
function LiveClock() {
  // `now` stays null until mount so SSR and first client render agree (no React
  // #418 hydration mismatch); the interval then ticks it every second.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Always render MELBOURNE time with the correct AEST/AEDT label, regardless of
  // the viewer's or server's timezone (the host runs on UTC — getHours() was
  // showing UTC mislabelled "AEST", 10h off). Intl does the DST-aware conversion.
  let time = "--:--:--";
  let label = "AEST";
  if (now) {
    const parts = melbourneParts(now);
    time = `${parts.hour}:${parts.minute}:${parts.second}`;
    if (/^A[EC][SD]T$/.test(parts.tz)) label = parts.tz; // AEST / AEDT
  }

  return (
    <span className="vp-clock" suppressHydrationWarning>
      {time} <span className="vp-clock-tz">{label}</span>
    </span>
  );
}

function melbourneParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZoneName: "short",
  }).formatToParts(d);
  const val = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: val("hour"),
    minute: val("minute"),
    second: val("second"),
    day: val("day"),
    month: val("month"),
    year: val("year"),
    tz: val("timeZoneName"),
  };
}

/**
 * LAST UPDATE — when the data on the map was last refreshed, in Melbourne time.
 * Renders a placeholder until mount so the server and client agree.
 */
function LastUpdate({ at }: { at: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  let text = "--:--";
  if (mounted && at) {
    const p = melbourneParts(new Date(at));
    text = `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}:${p.second} ${p.tz}`;
  }

  return (
    <span className="vp-stat-value vp-stat-value--mono" suppressHydrationWarning>
      {text}
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
const PlaneIcon = () => (
  <svg
    className="vp-stat-icon"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinejoin="round"
  >
    <path d="M12 2.6 13.5 9.4 21.6 13.2 12 12.4 2.4 13.2 10.5 9.4Z" />
    <path d="M12 12.4v8.9" />
  </svg>
);
const GroundIcon = () => (
  <svg
    className="vp-stat-icon"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinejoin="round"
  >
    <path d="M4 15.5h16M6.5 15.5 7.8 9.6A1.6 1.6 0 0 1 9.4 8.4h5.2a1.6 1.6 0 0 1 1.6 1.2l1.3 5.9" />
    <circle cx="8" cy="17.6" r="1.5" />
    <circle cx="16" cy="17.6" r="1.5" />
  </svg>
);
const ClockIcon = () => (
  <svg
    className="vp-stat-icon"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3.1 1.9" />
  </svg>
);

export function VPHeader({
  airCount,
  gndCount,
  silentCount,
  isLostSignal,
  isConnected,
  lastUpdate,
  groundAgeSec,
  onSubscribeClick,
  onNearestAircraft,
  onNearestGround,
}: VPHeaderProps) {
  // Three distinguishable states — red stays reserved for a genuinely lost
  // signal, so an overnight lull ("no aircraft up") reads as amber, not alarm.
  const liveState = isLostSignal ? "lost" : isConnected ? "online" : "standby";
  const liveLabel = isLostSignal ? "LOST SIGNAL" : isConnected ? "ONLINE" : "OFFLINE";

  /**
   * Fit the whole header into the width it is given, whatever device that is.
   *
   * The header is a single row of fixed-size groups, and the same groups are
   * rendered everywhere (the responsive rules that used to hide some of them below
   * 900px are gone). What changes per device is only the SCALE, so every platform
   * shows the same header with the same content, always in full — which is the
   * thing that was wrong before: on a narrow phone the row overflowed and read as
   * "blown out", and on a wide one the media query stripped groups out, so it read
   * as a different, smaller header.
   *
   * Measured at scale 1 every time, because reading the natural width while a
   * scale is already applied would measure the scaled result and ratchet down on
   * each pass.
   */
  const headerRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const inner = innerRef.current;
    if (!header || !inner) return;

    const fit = () => {
      header.style.setProperty("--vp-header-fit", "1");
      // Force layout so the measurement below reads the unscaled row.
      void inner.offsetWidth;
      const natural = inner.scrollWidth;
      const available = inner.clientWidth;
      if (!natural || !available) return;
      const scale = natural > available ? available / natural : 1;
      header.style.setProperty("--vp-header-fit", String(scale));
    };

    fit();
    // ResizeObserver rather than window.resize: this also has to react to the
    // rails changing width and to the browser's own chrome sliding in and out,
    // and Android fires no window resize for the latter.
    const ro = new ResizeObserver(fit);
    ro.observe(header);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  return (
    <header ref={headerRef} className={`vp-header ${isLostSignal ? "vp-lost" : ""}`}>
      <div ref={innerRef} className="vp-header-inner">
        {/* Brand */}
        <div className="vp-brand">
          <div className="vp-wordmark">VP·OVERWATCH</div>
          <div className="vp-subtitle">Melbourne Tactical</div>
        </div>

        <span className="vp-header-div" />

        {/* Live status */}
        <div className="vp-stat vp-stat--live">
          <span className={`vp-live-dot ${liveState}`} />
          <div className="vp-stat-body">
            <span className="vp-stat-label">Live Status</span>
            <span className={`vp-stat-value ${liveState}`}>{liveLabel}</span>
          </div>
        </div>

        <span className="vp-header-div" />

        {/* Aircraft */}
        <div
          className="vp-stat"
          onClick={onNearestAircraft}
          role={onNearestAircraft ? "button" : undefined}
          tabIndex={onNearestAircraft ? 0 : undefined}
          onKeyDown={(e) => { if (onNearestAircraft && e.key === "Enter") onNearestAircraft(); }}
          title={onNearestAircraft ? "Show the closest aircraft" : undefined}
          aria-label={onNearestAircraft ? "Aircraft tracked — tap for the closest" : undefined}
          style={onNearestAircraft ? { cursor: "pointer" } : undefined}
        >
          <PlaneIcon />
          <div className="vp-stat-body">
            <span className="vp-stat-label">Aircraft</span>
            <span className="vp-stat-row">
              <span className="vp-stat-value vp-stat-value--air">
                {String(airCount).padStart(2, "0")}
              </span>
              <span className="vp-stat-sub">Tracked</span>
            </span>
          </div>
        </div>

        {/* Ground */}
        <div
          className="vp-stat"
          onClick={onNearestGround}
          role={onNearestGround ? "button" : undefined}
          tabIndex={onNearestGround ? 0 : undefined}
          onKeyDown={(e) => { if (onNearestGround && e.key === "Enter") onNearestGround(); }}
          title={onNearestGround ? "Show the closest ground contact" : undefined}
          aria-label={onNearestGround ? "Ground contacts — tap for the closest" : undefined}
          style={onNearestGround ? { cursor: "pointer" } : undefined}
        >
          <GroundIcon />
          <div className="vp-stat-body">
            <span className="vp-stat-label">Ground</span>
            <span className="vp-stat-row">
              <span className="vp-stat-value vp-stat-value--gnd">
                {String(gndCount).padStart(2, "0")}
              </span>
              <span className="vp-stat-sub">Active</span>
            </span>
            {/* Freshness of the ground feed. "0 Active" with a fresh feed means
                there is genuinely nothing to draw; with a stale one the data
                stopped arriving and the map is empty for a different reason.
                Amber is the app's semantic "something needs attention". */}
            {groundAgeSec !== undefined && (
              <span
                className="vp-stat-sub"
                style={
                  groundAgeSec >= GROUND_STALE_AFTER_SEC
                    ? { color: "var(--vp-amber)", fontWeight: 600 }
                    : undefined
                }
              >
                {groundAgeSec >= GROUND_STALE_AFTER_SEC
                  ? "no data"
                  : `feed ${formatDataAge(groundAgeSec)}`}
              </span>
            )}
          </div>
        </div>

        {/* Silent aircraft — only when there are any */}
        {silentCount > 0 && (
          <div className="vp-stat vp-stat--silent">
            <div className="vp-stat-body">
              <span className="vp-stat-label">Silent</span>
              <span className="vp-stat-value vp-stat-value--silent">
                {String(silentCount).padStart(2, "0")}
              </span>
            </div>
          </div>
        )}

        <span className="vp-header-div vp-header-div--wide" />

        {/* Last update */}
        <div className="vp-stat vp-stat--update">
          <ClockIcon />
          <div className="vp-stat-body">
            <span className="vp-stat-label">Last Update</span>
            <LastUpdate at={lastUpdate} />
          </div>
        </div>

        {/* Local time — its own labelled group so it sits on the same
            label-over-value grid as every other status block instead of
            floating between the two rows. */}
        <div className="vp-stat vp-stat--clock">
          <ClockIcon />
          <div className="vp-stat-body">
            <span className="vp-stat-label">Local Time</span>
            <LiveClock />
          </div>
        </div>

        <div className="vp-header-spacer" />

        {/* Actions */}
        <div className="vp-header-actions">
          <PwaInstall />
          <button
            className="vp-btn vp-btn--subscribe"
            onClick={onSubscribeClick}
            aria-label="Subscribe to Hermes AI alerts"
          >
            <BellIcon />
            <span>Subscribe</span>
          </button>
        </div>
      </div>
    </header>
  );
}
