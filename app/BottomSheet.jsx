// Bottom sheet — live feed list, syncs with map.
// Snap points: peek (88px), half (50% of available), full (90%).

function BottomSheet({
  aircraft, reports, scrubT,
  selectedAircraftId, selectedReportId,
  onSelectAircraft, onSelectReport,
  snap, onSnapChange,
  containerHeight,
  detailContent,        // optional: when set, replaces the feed body
}) {
  const sheetRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [dragOffset, setDragOffset] = React.useState(0);
  const [tab, setTab] = React.useState('all'); // 'all' | 'air' | 'ground'

  const snaps = React.useMemo(() => {
    return {
      peek: 88,
      half: Math.round(containerHeight * 0.46),
      full: Math.round(containerHeight * 0.86),
    };
  }, [containerHeight]);

  const heightFor = (s) => snaps[s];

  const onPointerDown = (e) => {
    if (e.target.closest('.vp-feed-item')) return; // don't drag from items
    dragRef.current = { startY: e.clientY, startHeight: heightFor(snap) };
    sheetRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY;
    setDragOffset(dy);
  };
  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    const currentH = dragRef.current.startHeight + dragOffset;
    // Snap to nearest
    const dist = (s) => Math.abs(snaps[s] - currentH);
    const nearest = ['peek', 'half', 'full'].sort((a, b) => dist(a) - dist(b))[0];
    onSnapChange?.(nearest);
    setDragOffset(0);
    dragRef.current = null;
  };

  const currentHeight = heightFor(snap) + dragOffset;

  // Build feed: aircraft first, then reports by recency, filtered by active tab
  const feed = React.useMemo(() => {
    const items = [];
    if (tab !== 'ground') {
      aircraft.forEach(a => {
        const pos = sampleTrack(a.track, scrubT);
        if (pos) items.push({ kind: 'aircraft', obj: a, pos, t: scrubT });
      });
    }
    if (tab !== 'air') {
      reports.forEach(r => {
        const reportAgeAtScrub = r.reportedAgo - scrubT;
        if (reportAgeAtScrub < 0) return;
        items.push({ kind: 'report', obj: r, ageAtScrub: reportAgeAtScrub });
      });
    }
    return items;
  }, [aircraft, reports, scrubT, tab]);

  return (
    <div
      ref={sheetRef}
      className="vp-sheet"
      style={{ height: `${currentHeight}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="vp-sheet-handle"><div className="vp-sheet-handle-bar" /></div>
      {!detailContent && (
        <div className="vp-sheet-head">
          <div className="vp-sheet-title">
            <span>Active</span>
            <span className="vp-sheet-count num">{feed.length}</span>
          </div>
          <div className="vp-sheet-tabs">
            <button className={`vp-tab ${tab === 'all'    ? 'is-active' : ''}`} onClick={() => setTab('all')}>All</button>
            <button className={`vp-tab ${tab === 'air'    ? 'is-active' : ''}`} onClick={() => setTab('air')}>Air</button>
            <button className={`vp-tab ${tab === 'ground' ? 'is-active' : ''}`} onClick={() => setTab('ground')}>Ground</button>
          </div>
        </div>
      )}
      <div className="vp-sheet-body">
        {detailContent || feed.map((item, i) => (
          item.kind === 'aircraft' ? (
            <AircraftFeedItem
              key={item.obj.id}
              a={item.obj}
              pos={item.pos}
              selected={item.obj.id === selectedAircraftId}
              onClick={() => onSelectAircraft?.(item.obj.id)}
            />
          ) : (
            <ReportFeedItem
              key={item.obj.id}
              r={item.obj}
              ageAtScrub={item.ageAtScrub}
              selected={item.obj.id === selectedReportId}
              onClick={() => onSelectReport?.(item.obj.id)}
            />
          )
        ))}
      </div>

      <style>{`
        .vp-sheet {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          background: var(--ink-1);
          border-top-left-radius: var(--r-lg);
          border-top-right-radius: var(--r-lg);
          box-shadow: var(--shadow-sheet);
          touch-action: none;
          transition: ${dragging ? 'none' : 'height var(--dur-panel) var(--ease-spring)'};
          z-index: var(--z-sheet);
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .vp-sheet-handle {
          padding: 8px 0 4px;
          display: flex; align-items: center; justify-content: center;
          cursor: grab;
        }
        .vp-sheet-handle-bar {
          width: 36px; height: 4px;
          background: var(--ink-4);
          border-radius: var(--r-full);
        }
        .vp-sheet-head {
          padding: 6px 16px 12px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .vp-sheet-title {
          display: flex; align-items: baseline; gap: 8px;
          font-size: 13px; font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--fg-2);
        }
        .vp-sheet-count {
          font-size: 16px; font-weight: 600;
          color: var(--fg-1);
        }
        .vp-sheet-tabs {
          display: flex; gap: 2px;
          padding: 3px;
          background: var(--ink-2);
          border-radius: var(--r-full);
          border: 1px solid var(--border);
        }
        .vp-tab {
          background: transparent;
          border: none;
          height: 22px;
          padding: 0 10px;
          border-radius: var(--r-full);
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--fg-3);
          cursor: pointer;
          text-transform: uppercase;
          transition: background var(--dur-hover) var(--ease-out), color var(--dur-hover) var(--ease-out);
        }
        .vp-tab:hover { color: var(--fg-1); }
        .vp-tab.is-active { background: var(--ink-3); color: var(--fg-1); }
        .vp-sheet-body {
          flex: 1;
          overflow-y: auto;
          padding: 0 12px 80px;
        }
        .vp-feed-item {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 8px;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          border-radius: var(--r-sm);
          transition: background var(--dur-hover) var(--ease-out);
        }
        .vp-feed-item:hover { background: var(--ink-2); }
        .vp-feed-item.is-selected {
          background: color-mix(in srgb, var(--blue) 8%, var(--ink-2));
          border-color: transparent;
        }
        .vp-feed-icon {
          flex-shrink: 0;
          width: 36px; height: 36px;
          border-radius: var(--r-md);
          background: var(--ink-2);
          display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--border);
        }
        .vp-feed-icon.tone-amber { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 30%, var(--border)); background: var(--amber-wash); }
        .vp-feed-icon.tone-red   { color: var(--red);   border-color: color-mix(in srgb, var(--red) 30%, var(--border));   background: var(--red-wash); }
        .vp-feed-body { flex: 1; min-width: 0; }
        .vp-feed-line1 {
          display: flex; align-items: baseline; gap: 8px;
          margin-bottom: 2px;
        }
        .vp-feed-ident {
          font-family: var(--font-mono);
          font-size: 13px; font-weight: 600;
          color: var(--fg-1);
          letter-spacing: 0.04em;
        }
        .vp-feed-type {
          font-size: 11px;
          color: var(--fg-3);
        }
        .vp-feed-line2 {
          display: flex; align-items: center; gap: 6px;
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: var(--fg-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vp-feed-sep { color: var(--fg-4); }
        .vp-feed-trend.up { color: var(--green); }
        .vp-feed-trend.dn { color: var(--amber); }
        .vp-feed-meta {
          flex-shrink: 0;
          text-align: right;
        }
        .vp-feed-distance {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          font-size: 12px; font-weight: 500;
          color: var(--fg-1);
          letter-spacing: 0.02em;
        }
        .vp-feed-bearing {
          font-family: var(--font-mono);
          font-size: 9.5px;
          color: var(--fg-3);
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}

function AircraftFeedItem({ a, pos, selected, onClick }) {
  const distNm = computeDistance(pos.x, pos.y) / 1852;
  const bearing = computeBearing(pos.x, pos.y);
  const trend = pos.vs > 50 ? 'up' : pos.vs < -50 ? 'dn' : null;
  // Time airborne / estimated return — drives the mini progress strip
  const airborneSec = a.timeAirborneSeconds || 0;
  const returnSec = a.estimatedReturnSeconds || 0;
  const histSec = a.historicalAverageSeconds || 1;
  const total = airborneSec + returnSec;
  const pct = Math.min(1, airborneSec / Math.max(total, 1));
  const overrun = airborneSec > histSec;
  return (
    <div className={`vp-feed-item vp-feed-aircraft ${selected ? 'is-selected' : ''}`} onClick={onClick}>
      <div className="vp-feed-icon tone-amber">
        <Icon name={a.role === 'rotary' ? 'helicopter' : 'plane'} size={18} stroke={1.6} />
      </div>
      <div className="vp-feed-body">
        <div className="vp-feed-line1">
          <span className="vp-feed-ident">{a.registration}</span>
          {a.callsign && <span className="vp-feed-callsign">{a.callsign}</span>}
          <span className="vp-feed-type">· {a.type}</span>
        </div>
        <div className="vp-feed-line2">
          <span>{pos.alt.toLocaleString()}ft</span>
          {trend && <span className={`vp-feed-trend ${trend}`}>{trend === 'up' ? '↑' : '↓'}</span>}
          <span className="vp-feed-sep">·</span>
          <span>{pos.spd.toFixed(0)}kts</span>
          <span className="vp-feed-sep">·</span>
          <span>{String(pos.hdg).padStart(3, '0')}°</span>
        </div>
        {/* Airborne progress strip — signature feature */}
        <div className="vp-feed-airborne">
          <div className="vp-feed-airborne-bar">
            <div className="vp-feed-airborne-fill" style={{ width: `${pct * 100}%` }} />
            <div className="vp-feed-airborne-tick" style={{ left: `${(histSec / Math.max(total, histSec)) * 100}%` }} />
            {overrun && <div className="vp-feed-airborne-overrun" />}
          </div>
          <div className="vp-feed-airborne-times num">
            <span>{formatSec(airborneSec)}</span>
            <span className={overrun ? 'overrun' : ''}>{overrun ? 'past avg' : `−${formatSec(returnSec)}`}</span>
          </div>
        </div>
      </div>
      <div className="vp-feed-meta">
        <div className="vp-feed-distance">{distNm.toFixed(1)}nm</div>
        <div className="vp-feed-bearing">{compassFromBearing(bearing)}</div>
      </div>
      <style>{`
        .vp-feed-aircraft .vp-feed-body { padding-right: 4px; }
        .vp-feed-callsign {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--amber);
          letter-spacing: 0.04em;
        }
        .vp-feed-airborne {
          margin-top: 6px;
          display: flex; align-items: center; gap: 8px;
        }
        .vp-feed-airborne-bar {
          position: relative;
          flex: 1;
          height: 3px;
          background: var(--ink-3);
          border-radius: var(--r-full);
          overflow: hidden;
        }
        .vp-feed-airborne-fill {
          position: absolute; top: 0; left: 0; bottom: 0;
          background: var(--amber);
          border-radius: var(--r-full);
        }
        .vp-feed-airborne-tick {
          position: absolute; top: -1px; bottom: -1px;
          width: 1px;
          background: var(--fg-2);
          opacity: 0.6;
          transform: translateX(-50%);
        }
        .vp-feed-airborne-overrun {
          position: absolute; top: 0; bottom: 0; left: 0; right: 0;
          background: repeating-linear-gradient(-45deg, var(--red) 0 3px, transparent 3px 6px);
          opacity: 0.5;
        }
        .vp-feed-airborne-times {
          display: flex; gap: 8px;
          font-size: 9px;
          color: var(--fg-3);
          white-space: nowrap;
        }
        .vp-feed-airborne-times .overrun { color: var(--red); }
      `}</style>
    </div>
  );
}

function ReportFeedItem({ r, ageAtScrub, selected, onClick }) {
  const distMi = computeDistance(r.x, r.y) / 1609;
  const bearing = computeBearing(r.x, r.y);
  return (
    <div className={`vp-feed-item ${selected ? 'is-selected' : ''}`} onClick={onClick}>
      <div className="vp-feed-icon tone-red">
        <Icon name={iconForReport(r.kind)} size={16} stroke={1.6} />
      </div>
      <div className="vp-feed-body">
        <div className="vp-feed-line1">
          <span className="vp-feed-ident" style={{ fontFamily: 'var(--font-ui)', fontSize: 13, letterSpacing: 0 }}>
            {labelForReport(r.kind)}
          </span>
          <span className={`chip chip-${r.confirmations >= 5 ? 'confirm' : 'stale'}`} style={{ fontSize: 9 }}>
            {r.confirmations >= 5 ? `${r.confirmations}× CONFIRMED` : `${r.confirmations} report${r.confirmations > 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="vp-feed-line2">
          <span style={{ fontFamily: 'var(--font-ui)', letterSpacing: 0 }}>{r.descr}</span>
        </div>
      </div>
      <div className="vp-feed-meta">
        <div className="vp-feed-distance">{distMi.toFixed(1)}mi</div>
        <div className="vp-feed-bearing">{compassFromBearing(bearing)} · {formatSec(r.lastConfirmedAgo)}</div>
      </div>
    </div>
  );
}

function iconForReport(kind) {
  switch (kind) {
    case 'marked': return 'car';
    case 'unmarked': return 'car';
    case 'hidden': return 'eye';
    case 'stop': return 'alert';
    case 'checkpoint': return 'alert';
    case 'rbt': return 'alert';
    case 'camera': return 'eye';
    default: return 'pin';
  }
}
function labelForReport(kind) {
  switch (kind) {
    case 'marked': return 'Marked unit';
    case 'unmarked': return 'Unmarked unit';
    case 'hidden': return 'Hidden unit';
    case 'stop': return 'Roadside stop';
    case 'checkpoint': return 'Checkpoint';
    case 'rbt': return 'RBT checkpoint';
    case 'camera': return 'Speed camera';
    default: return 'Ground report';
  }
}
function computeDistance(x, y) { return Math.hypot(x, y); } // meters from origin (user)
function computeBearing(x, y) {
  let deg = Math.atan2(x, y) * 180 / Math.PI;
  return (deg + 360) % 360;
}
function compassFromBearing(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

window.BottomSheet = BottomSheet;
window.computeDistance = computeDistance;
window.computeBearing = computeBearing;
window.compassFromBearing = compassFromBearing;
window.iconForReport = iconForReport;
window.labelForReport = labelForReport;
