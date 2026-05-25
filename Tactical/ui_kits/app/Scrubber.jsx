// Time Scrubber — VP-Overwatch signature interaction.
//
// Spans 60 minutes (default). Shows an activity histogram from aircraft + report data.
// Draggable playhead snaps magnetically to "now" within ±15s.
// Off-now leaves a "ghost now" marker; tap NOW button to spring back.
//
// Emits onChange(secondsAgo) on drag, onChange(0) when snapped to live.

const { useEffect: useEffect_s, useRef: useRef_s, useState: useState_s, useMemo } = React;

function TimeScrubber({
  aircraft, reports,
  value, onChange,           // value in seconds-ago (0 = now)
  windowSec = 3600,          // 60 minutes
  density = 'comfortable',   // 'compact' | 'comfortable'
}) {
  const trackRef = useRef_s(null);
  const [dragging, setDragging] = useState_s(false);
  const draggingRef = useRef_s(false);
  draggingRef.current = dragging;

  const isLive = value < 0.5;

  // Build a sparse activity histogram. 60 buckets, one per minute.
  const histogram = useMemo(() => {
    const buckets = new Array(60).fill(0);
    aircraft.forEach(a => {
      for (let m = 0; m < 60; m++) {
        const t = m * 60;
        const pos = sampleTrack(a.track, t);
        if (pos) buckets[m] += 1;
      }
    });
    reports.forEach(r => {
      const reportedMin = Math.floor(r.reportedAgo / 60);
      for (let m = 0; m < 60; m++) {
        if (m >= reportedMin) buckets[m] += 0.0; // exist
        if (m === reportedMin) buckets[m] += 1.5; // new report event
      }
    });
    // Normalize
    const max = Math.max(...buckets, 1);
    return buckets.map(b => b / max);
  }, [aircraft, reports]);

  const pctFromValue = (v) => 100 * (1 - Math.min(1, Math.max(0, v / windowSec)));

  const handlePointer = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const u = 1 - (x / rect.width);  // 0 = now (right), 1 = oldest (left)
    let secondsAgo = u * windowSec;
    // Magnetic snap to now within 15s
    if (secondsAgo < 15) secondsAgo = 0;
    onChange?.(secondsAgo);
  };

  const onDown = (e) => {
    setDragging(true);
    trackRef.current.setPointerCapture(e.pointerId);
    handlePointer(e.clientX);
    if (navigator.vibrate) navigator.vibrate(4);
  };
  const onMove = (e) => {
    if (!draggingRef.current) return;
    handlePointer(e.clientX);
  };
  const onUp = (e) => {
    if (!draggingRef.current) return;
    setDragging(false);
    try { trackRef.current.releasePointerCapture(e.pointerId); } catch {}
  };

  const playheadPct = pctFromValue(value);
  const trackHeight = density === 'compact' ? 44 : 56;

  return (
    <div className="vp-scrub" style={{ '--scrub-h': `${trackHeight}px` }}>
      <div className="vp-scrub-head">
        <div className="vp-scrub-labels">
          <span className="vp-scrub-time num">
            {isLive ? 'LIVE' : `−${formatSec(value)}`}
          </span>
          <span className="vp-scrub-clock num">
            {clockAt(value)}
          </span>
        </div>
        <button
          className={`vp-scrub-now ${isLive ? 'is-live' : 'is-past'}`}
          onClick={() => onChange?.(0)}
          aria-pressed={isLive}
        >
          {isLive ? (
            <>
              <span className="vp-scrub-now-dot dot-pulse" />
              <span>LIVE</span>
            </>
          ) : (
            <>
              <Icon name="play" size={11} fill="currentColor" />
              <span>SNAP TO NOW</span>
            </>
          )}
        </button>
      </div>

      <div
        ref={trackRef}
        className={`vp-scrub-track ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* Tick grid */}
        <div className="vp-scrub-ticks">
          {[0, 15, 30, 45, 60].map(m => (
            <div
              key={m}
              className="vp-scrub-tick"
              style={{ left: `${100 - (m / 60) * 100}%` }}
            >
              <span className="vp-scrub-tick-label num">−{m}m</span>
              <span className="vp-scrub-tick-mark" />
            </div>
          ))}
        </div>

        {/* Histogram bars */}
        <div className="vp-scrub-hist">
          {histogram.map((v, i) => (
            <div
              key={i}
              className="vp-scrub-bar"
              style={{
                left: `${100 - ((i + 0.5) / 60) * 100}%`,
                height: `${10 + v * 70}%`,
              }}
            />
          ))}
        </div>

        {/* "Ghost now" marker when not at live */}
        {!isLive && (
          <div className="vp-scrub-ghost" style={{ left: '100%' }}>
            <div className="vp-scrub-ghost-line" />
            <div className="vp-scrub-ghost-label num">NOW</div>
          </div>
        )}

        {/* Playhead */}
        <div className="vp-scrub-playhead" style={{ left: `${playheadPct}%` }}>
          <div className={`vp-scrub-playhead-line ${isLive ? 'is-live' : ''}`} />
          <div className={`vp-scrub-playhead-handle ${isLive ? 'is-live' : ''} ${dragging ? 'is-dragging' : ''}`}>
            <div className="vp-scrub-playhead-handle-inner" />
          </div>
        </div>
      </div>

      <style>{`
        .vp-scrub {
          background: color-mix(in srgb, var(--ink-1) 88%, transparent);
          backdrop-filter: blur(20px) saturate(140%);
          -webkit-backdrop-filter: blur(20px) saturate(140%);
          border-top: 1px solid var(--border-subtle);
          padding: 8px 14px 12px 14px;
          user-select: none;
        }
        .vp-scrub-head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 6px;
          padding: 0 2px;
        }
        .vp-scrub-labels { display: flex; align-items: baseline; gap: 10px; }
        .vp-scrub-time {
          font-size: 13px; font-weight: 600;
          color: var(--fg-1);
          letter-spacing: 0.04em;
        }
        .vp-scrub-clock {
          font-size: 11px;
          color: var(--fg-3);
          letter-spacing: 0.02em;
        }
        .vp-scrub-now {
          display: inline-flex; align-items: center; gap: 6px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--blue);
          height: 24px;
          padding: 0 10px;
          border-radius: var(--r-full);
          font-family: var(--font-mono);
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background var(--dur-hover) var(--ease-out),
                      border-color var(--dur-hover) var(--ease-out),
                      transform var(--dur-press) var(--ease-spring);
        }
        .vp-scrub-now.is-live { color: var(--blue); cursor: default; }
        .vp-scrub-now.is-past {
          background: var(--blue);
          color: #fff;
        }
        .vp-scrub-now.is-past:hover { background: var(--blue-hi); }
        .vp-scrub-now.is-past:active { transform: scale(0.97); }
        .vp-scrub-now-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--blue);
          color: var(--blue);
        }
        .vp-scrub-track {
          position: relative;
          height: var(--scrub-h);
          touch-action: none;
          cursor: ew-resize;
        }
        .vp-scrub-ticks {
          position: absolute; inset: 0;
        }
        .vp-scrub-tick {
          position: absolute; top: 0; bottom: 0;
          width: 0;
          transform: translateX(-50%);
        }
        .vp-scrub-tick-mark {
          position: absolute; bottom: 0;
          left: 0; transform: translateX(-50%);
          width: 1px; height: 4px;
          background: var(--border);
        }
        .vp-scrub-tick-label {
          position: absolute; bottom: 6px;
          left: 0; transform: translateX(-50%);
          font-size: 9px;
          color: var(--fg-4);
          white-space: nowrap;
          letter-spacing: 0.02em;
        }
        .vp-scrub-hist {
          position: absolute;
          left: 0; right: 0;
          bottom: 12px;
          height: calc(var(--scrub-h) - 12px);
        }
        .vp-scrub-bar {
          position: absolute;
          bottom: 0;
          width: 4px;
          transform: translateX(-50%);
          background: var(--ink-4);
          border-radius: 2px 2px 0 0;
          transition: background var(--dur-hover) var(--ease-out);
        }
        .vp-scrub-track.is-dragging .vp-scrub-bar { background: var(--ink-3); }
        /* Bars to the right of playhead = "live" tinted */
        .vp-scrub-ghost {
          position: absolute;
          top: 0; bottom: 0;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .vp-scrub-ghost-line {
          position: absolute; top: 0; bottom: 12px;
          left: 0;
          width: 1px;
          background: var(--blue);
          opacity: 0.4;
          box-shadow: 0 0 6px var(--blue-glow);
        }
        .vp-scrub-ghost-label {
          position: absolute;
          top: -2px;
          left: 0; transform: translateX(-100%) translateX(-4px);
          font-size: 9px; font-weight: 600;
          color: var(--blue);
          letter-spacing: 0.10em;
          opacity: 0.7;
        }
        .vp-scrub-playhead {
          position: absolute;
          top: 0; bottom: 0;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .vp-scrub-playhead-line {
          position: absolute; top: 0; bottom: 12px;
          left: 0;
          width: 1.5px;
          background: var(--blue);
          box-shadow: 0 0 8px var(--blue-glow);
        }
        .vp-scrub-playhead-line.is-live {
          background: var(--blue);
          box-shadow: 0 0 10px var(--blue);
        }
        .vp-scrub-playhead-handle {
          position: absolute;
          top: -2px;
          left: 0; transform: translateX(-50%);
          width: 20px; height: 20px;
          border-radius: 50%;
          background: var(--blue);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue) 18%, transparent),
                      0 2px 8px rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          transition: transform var(--dur-hover) var(--ease-spring),
                      box-shadow var(--dur-hover) var(--ease-out);
        }
        .vp-scrub-playhead-handle.is-dragging {
          transform: translateX(-50%) scale(1.15);
        }
        .vp-scrub-playhead-handle-inner {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #fff;
        }
      `}</style>
    </div>
  );
}

function clockAt(scrubT) {
  const d = new Date(Date.now() - scrubT * 1000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

window.TimeScrubber = TimeScrubber;
