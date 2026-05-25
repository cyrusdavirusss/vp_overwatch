// Floating action cluster — bottom-right.
// Layers, recenter, filters.

function FabCluster({ onLayers, onFilters, onRecenter, onInspect, followUser }) {
  return (
    <div className="vp-fab-cluster">
      <FabBtn onClick={onLayers} label="Layers"><Icon name="layers" size={18} /></FabBtn>
      <FabBtn onClick={onFilters} label="Filter"><Icon name="filter" size={18} /></FabBtn>
      <FabBtn onClick={onInspect} label="Inspect"><Icon name="search" size={18} /></FabBtn>
      <FabBtn onClick={onRecenter} primary label="Recenter">
        <Icon name="crosshair" size={18} />
        {followUser && <span className="vp-fab-follow" />}
      </FabBtn>

      <style>{`
        .vp-fab-cluster {
          position: absolute;
          right: 12px;
          bottom: 0;
          display: flex; flex-direction: column; gap: 8px;
          z-index: var(--z-overlay);
        }
        .vp-fab {
          width: 44px; height: 44px;
          border-radius: var(--r-md);
          background: color-mix(in srgb, var(--ink-1) 92%, transparent);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid var(--border);
          color: var(--fg-1);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          box-shadow: var(--shadow-fab);
          transition: background var(--dur-hover) var(--ease-out),
                      transform var(--dur-press) var(--ease-spring);
          position: relative;
        }
        .vp-fab:hover { background: var(--ink-3); }
        .vp-fab:active { transform: scale(0.94); }
        .vp-fab.is-primary {
          background: var(--blue);
          color: #fff;
          border-color: var(--blue);
        }
        .vp-fab.is-primary:hover { background: var(--blue-hi); }
        .vp-fab-follow {
          position: absolute;
          top: -2px; right: -2px;
          width: 8px; height: 8px;
          background: var(--green);
          border: 2px solid var(--ink-0);
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
}

function FabBtn({ onClick, label, primary, children }) {
  return (
    <button className={`vp-fab ${primary ? 'is-primary' : ''}`} onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

// -----------------------------------------------------------------
// Long-press inspect pin — drops a circle showing all data within radius
// -----------------------------------------------------------------
function InspectPin({ position, aircraft, reports, scrubT, onClose, radius = 1.0 }) {
  if (!position) return null;
  const radiusMeters = radius * 1609;

  // Tally items inside radius (synthetic — counts at current scrub time)
  const inside = React.useMemo(() => {
    let air = 0, rep = 0;
    aircraft.forEach(a => {
      const p = sampleTrack(a.track, scrubT);
      if (!p) return;
      const d = Math.hypot(p.x - position.x, p.y - position.y);
      if (d <= radiusMeters) air++;
    });
    reports.forEach(r => {
      if (r.reportedAgo - scrubT < 0) return;
      const d = Math.hypot(r.x - position.x, r.y - position.y);
      if (d <= radiusMeters) rep++;
    });
    return { air, rep };
  }, [position, aircraft, reports, scrubT, radiusMeters]);

  return (
    <div
      className="vp-inspect"
      style={{
        left: position.sx, top: position.sy,
      }}
    >
      <div className="vp-inspect-circle" style={{
        width: radius * 200, height: radius * 200,
      }} />
      <div className="vp-inspect-card">
        <button className="vp-inspect-close" onClick={onClose}><Icon name="close" size={12} /></button>
        <div className="vp-inspect-row">
          <div className="vp-inspect-num num">{String(inside.air).padStart(2, '0')}</div>
          <div className="vp-inspect-label">airborne</div>
        </div>
        <div className="vp-inspect-row">
          <div className="vp-inspect-num num" style={{ color: 'var(--red)' }}>{String(inside.rep).padStart(2, '0')}</div>
          <div className="vp-inspect-label">ground</div>
        </div>
        <div className="vp-inspect-radius num">r {radius.toFixed(1)}mi</div>
      </div>

      <style>{`
        .vp-inspect {
          position: absolute;
          transform: translate(-50%, -50%);
          z-index: var(--z-overlay);
          pointer-events: none;
        }
        .vp-inspect-circle {
          position: absolute;
          left: 50%; top: 50%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          border: 1.5px dashed var(--blue);
          background: color-mix(in srgb, var(--blue) 5%, transparent);
          animation: vp-inspect-pop 400ms var(--ease-spring);
        }
        @keyframes vp-inspect-pop {
          from { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        .vp-inspect-card {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, calc(50% + 16px));
          background: var(--ink-1);
          border: 1px solid var(--blue);
          border-radius: var(--r-md);
          padding: 8px 12px;
          box-shadow: var(--shadow-pop);
          pointer-events: auto;
          display: flex; align-items: center; gap: 14px;
          white-space: nowrap;
          animation: vp-inspect-card-in 400ms var(--ease-spring);
        }
        @keyframes vp-inspect-card-in {
          from { transform: translate(-50%, calc(50% + 28px)); opacity: 0; }
          to { transform: translate(-50%, calc(50% + 16px)); opacity: 1; }
        }
        .vp-inspect-close {
          position: absolute;
          top: -8px; right: -8px;
          width: 20px; height: 20px;
          border: none;
          background: var(--ink-3);
          color: var(--fg-2);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
        }
        .vp-inspect-row {
          display: flex; flex-direction: column; align-items: center; gap: 1px;
        }
        .vp-inspect-num {
          font-size: 18px; font-weight: 600;
          color: var(--amber);
          line-height: 1;
        }
        .vp-inspect-label {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--fg-3);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .vp-inspect-radius {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--blue);
          padding-left: 14px;
          border-left: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}

window.FabCluster = FabCluster;
window.InspectPin = InspectPin;
