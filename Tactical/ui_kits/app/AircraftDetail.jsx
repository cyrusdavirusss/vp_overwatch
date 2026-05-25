// Aircraft detail panel — slide-up.
// Shows callsign, ICAO hex, type, operator, alt + trend, spd, hdg, vs, time tracked,
// distance/bearing from user, and altitude-over-time sparkline.

function AircraftDetail({ aircraft, scrubT, onClose }) {
  if (!aircraft) return null;

  const pos = sampleTrack(aircraft.track, scrubT);
  if (!pos) return null;

  const distNm = computeDistance(pos.x, pos.y) / 1852;
  const bearing = computeBearing(pos.x, pos.y);
  const trackedMin = Math.floor((aircraft.track.length * 4) / 60);
  const trend = pos.vs > 50 ? 'climb' : pos.vs < -50 ? 'descend' : 'level';

  // Sparkline data — altitude over last 15 minutes
  const sparkData = React.useMemo(() => {
    const out = [];
    for (let m = 0; m < 15; m++) {
      const t = scrubT + m * 60;
      const p = sampleTrack(aircraft.track, t);
      if (p) out.push({ t, alt: p.alt });
    }
    return out.reverse();
  }, [aircraft, scrubT]);

  return (
    <div className="vp-detail vp-detail-aircraft">
      <div className="vp-detail-head">
        <div className="vp-detail-ident">
          <div className="vp-detail-callsign num">{aircraft.callsign}</div>
          <div className="vp-detail-meta">
            <span className="vp-detail-hex num">{aircraft.icao}</span>
            <span className="vp-detail-sep">·</span>
            <span>{aircraft.type}</span>
          </div>
        </div>
        <button className="vp-detail-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="vp-detail-operator">
        <span className="chip chip-aircraft">{aircraft.operatorShort}</span>
        <span>{aircraft.operator}</span>
      </div>

      {/* SIGNATURE: time airborne + estimated return — the brief's core feature */}
      <FlightTimer
        timeAirborneSeconds={aircraft.timeAirborneSeconds}
        estimatedReturnSeconds={aircraft.estimatedReturnSeconds}
        historicalAverageSeconds={aircraft.historicalAverageSeconds}
      />

      {/* Primary metrics grid */}
      <div className="vp-detail-grid">
        <Metric label="alt" value={pos.alt.toLocaleString()} unit="ft" trend={trend} mono />
        <Metric label="spd" value={pos.spd.toFixed(0)} unit="kts" mono />
        <Metric label="hdg" value={String(pos.hdg).padStart(3, '0')} unit="°" mono />
        <Metric
          label="v/s"
          value={pos.vs >= 0 ? `+${Math.abs(pos.vs)}` : `−${Math.abs(pos.vs)}`}
          unit="ft/m"
          tone={pos.vs > 50 ? 'green' : pos.vs < -50 ? 'amber' : 'default'}
          mono
        />
      </div>

      {/* Sparkline */}
      <div className="vp-detail-spark">
        <div className="vp-detail-spark-head">
          <span className="t-label">Altitude · last 15m</span>
          <span className="vp-detail-spark-range num">
            {Math.min(...sparkData.map(d => d.alt)).toLocaleString()} – {Math.max(...sparkData.map(d => d.alt)).toLocaleString()}ft
          </span>
        </div>
        <Sparkline data={sparkData.map(d => d.alt)} height={48} />
      </div>

      {/* Secondary row */}
      <div className="vp-detail-secondary">
        <SecondaryStat label="tracked" value={`${trackedMin}m`} mono />
        <SecondaryStat label="distance" value={`${distNm.toFixed(1)}nm`} mono />
        <SecondaryStat label="bearing" value={`${String(Math.round(bearing)).padStart(3, '0')}° ${compassFromBearing(bearing)}`} mono />
      </div>

      <style>{`
        .vp-detail {
          background: var(--ink-1);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          padding: 16px;
          margin: 0 12px;
        }
        .vp-detail-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          margin-bottom: 8px;
        }
        .vp-detail-ident { display: flex; flex-direction: column; gap: 2px; }
        .vp-detail-callsign {
          font-size: 22px; font-weight: 600;
          color: var(--fg-1);
          letter-spacing: 0.04em;
          line-height: 1;
        }
        .vp-detail-meta {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px;
          color: var(--fg-3);
        }
        .vp-detail-hex { font-weight: 500; color: var(--fg-2); letter-spacing: 0.06em; }
        .vp-detail-sep { color: var(--fg-4); }
        .vp-detail-close {
          width: 32px; height: 32px;
          background: var(--ink-2);
          border: 1px solid var(--border);
          color: var(--fg-2);
          border-radius: var(--r-md);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background var(--dur-hover) var(--ease-out);
        }
        .vp-detail-close:hover { background: var(--ink-3); color: var(--fg-1); }
        .vp-detail-operator {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 14px;
          font-size: 12px;
          color: var(--fg-2);
        }
        .vp-detail-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 2px;
          background: var(--border-subtle);
          border-radius: var(--r-md);
          overflow: hidden;
          margin-bottom: 14px;
        }
        .vp-detail-spark {
          margin-bottom: 14px;
          padding: 10px 12px;
          background: var(--ink-2);
          border: 1px solid var(--border);
          border-radius: var(--r-md);
        }
        .vp-detail-spark-head {
          display: flex; align-items: baseline; justify-content: space-between;
          margin-bottom: 8px;
        }
        .vp-detail-spark-range {
          font-size: 10px;
          color: var(--fg-3);
        }
        .vp-detail-secondary {
          display: flex;
          gap: 16px;
          padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }
      `}</style>
    </div>
  );
}

function Metric({ label, value, unit, trend, tone = 'default', mono }) {
  return (
    <div className="vp-metric">
      <div className="vp-metric-label">{label}</div>
      <div className={`vp-metric-value ${mono ? 'num' : ''} tone-${tone}`}>
        {value}
        {trend === 'climb' && <span className="vp-metric-trend up">↑</span>}
        {trend === 'descend' && <span className="vp-metric-trend dn">↓</span>}
      </div>
      <div className="vp-metric-unit">{unit}</div>
      <style>{`
        .vp-metric {
          background: var(--ink-2);
          padding: 10px 12px;
        }
        .vp-metric-label {
          font-family: var(--font-mono);
          font-size: 9px; font-weight: 500;
          color: var(--fg-3);
          letter-spacing: 0.10em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .vp-metric-value {
          font-size: 20px; font-weight: 600;
          color: var(--fg-1);
          line-height: 1;
          letter-spacing: -0.01em;
          display: flex; align-items: center; gap: 4px;
        }
        .vp-metric-value.tone-green { color: var(--green); }
        .vp-metric-value.tone-amber { color: var(--amber); }
        .vp-metric-value.tone-red   { color: var(--red); }
        .vp-metric-trend.up { color: var(--green); font-size: 14px; }
        .vp-metric-trend.dn { color: var(--amber); font-size: 14px; }
        .vp-metric-unit {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--fg-3);
          margin-top: 3px;
          letter-spacing: 0.02em;
        }
      `}</style>
    </div>
  );
}

function SecondaryStat({ label, value, mono }) {
  return (
    <div className="vp-sec-stat">
      <div className="vp-sec-stat-label">{label}</div>
      <div className={`vp-sec-stat-value ${mono ? 'num' : ''}`}>{value}</div>
      <style>{`
        .vp-sec-stat { flex: 1; }
        .vp-sec-stat-label {
          font-family: var(--font-mono);
          font-size: 9px; font-weight: 500;
          color: var(--fg-3);
          letter-spacing: 0.10em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .vp-sec-stat-value {
          font-size: 13px; font-weight: 500;
          color: var(--fg-1);
          letter-spacing: 0.02em;
        }
      `}</style>
    </div>
  );
}

function Sparkline({ data, height = 48 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const W = 280;
  const stepX = W / (data.length - 1 || 1);
  const points = data.map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 8) - 4}`).join(' ');
  // Area fill path
  const areaPath = `M 0,${height} L ${points.split(' ').join(' L ')} L ${(data.length - 1) * stepX},${height} Z`;
  const linePath = `M ${points.split(' ').join(' L ')}`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-grad)" />
      <path d={linePath} stroke="var(--amber)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Current point */}
      <circle
        cx={(data.length - 1) * stepX}
        cy={height - ((data[data.length - 1] - min) / range) * (height - 8) - 4}
        r="3"
        fill="var(--amber)"
      />
    </svg>
  );
}

// -----------------------------------------------------------------
// FlightTimer — time airborne live counter + predictive landing countdown,
// driven by historical average duration. Signature widget for this product.
// -----------------------------------------------------------------
function FlightTimer({ timeAirborneSeconds, estimatedReturnSeconds, historicalAverageSeconds }) {
  // Live counter — tick once per second
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const liveAirborne = timeAirborneSeconds + tick;
  const liveReturn   = Math.max(0, estimatedReturnSeconds - tick);

  // Progress = airborne / (airborne + return) — normalized against the prediction.
  // If we're past the historical average, the bar overruns into a "long flight" zone.
  const total = liveAirborne + liveReturn;
  const pct = Math.min(1, liveAirborne / Math.max(total, 1));
  const overrun = liveAirborne > historicalAverageSeconds;
  const overrunPct = overrun ? Math.min(1, (liveAirborne - historicalAverageSeconds) / historicalAverageSeconds) : 0;

  return (
    <div className="vp-ftimer">
      <div className="vp-ftimer-head">
        <div className="vp-ftimer-side">
          <div className="vp-ftimer-side-label">airborne</div>
          <div className="vp-ftimer-side-value num">{formatHMS(liveAirborne)}</div>
        </div>
        <div className="vp-ftimer-center">
          <div className="vp-ftimer-avg-label">historical avg</div>
          <div className="vp-ftimer-avg-value num">{formatHM(historicalAverageSeconds)}</div>
        </div>
        <div className="vp-ftimer-side vp-ftimer-side-right">
          <div className="vp-ftimer-side-label">est. return in</div>
          <div className="vp-ftimer-side-value num">{formatHMS(liveReturn)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="vp-ftimer-bar">
        <div className="vp-ftimer-bar-fill" style={{ width: `${pct * 100}%` }} />
        {/* Historical average tick — labelled */}
        <div className="vp-ftimer-bar-tick" style={{ left: `${(historicalAverageSeconds / Math.max(total, historicalAverageSeconds)) * 100}%` }}>
          <div className="vp-ftimer-bar-tick-line" />
        </div>
        {/* Overrun shimmer */}
        {overrun && (
          <div className="vp-ftimer-bar-overrun" style={{ width: `${overrunPct * 100}%` }} />
        )}
      </div>
      <div className="vp-ftimer-foot">
        <span className="num">0:00</span>
        <span className={overrun ? 'overrun' : ''}>{overrun ? `${formatHM(liveAirborne - historicalAverageSeconds)} past avg` : 'flight in progress'}</span>
        <span className="num">{formatHM(Math.max(total, historicalAverageSeconds))}</span>
      </div>

      <style>{`
        .vp-ftimer {
          background: var(--ink-2);
          border: 1px solid var(--border);
          border-radius: var(--r-md);
          padding: 12px 14px;
          margin-bottom: 14px;
        }
        .vp-ftimer-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          margin-bottom: 10px;
        }
        .vp-ftimer-side { flex: 1; }
        .vp-ftimer-side-right { text-align: right; }
        .vp-ftimer-side-label {
          font-family: var(--font-mono);
          font-size: 9px; font-weight: 500;
          color: var(--fg-3);
          letter-spacing: 0.10em;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .vp-ftimer-side-value {
          font-size: 18px; font-weight: 600;
          color: var(--fg-1);
          line-height: 1;
          letter-spacing: -0.01em;
        }
        .vp-ftimer-center {
          text-align: center;
          padding: 0 8px;
          border-left: 1px solid var(--border-subtle);
          border-right: 1px solid var(--border-subtle);
          margin: 0 8px;
        }
        .vp-ftimer-avg-label {
          font-family: var(--font-mono);
          font-size: 9px; font-weight: 500;
          color: var(--fg-3);
          letter-spacing: 0.10em;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .vp-ftimer-avg-value {
          font-size: 13px; font-weight: 500;
          color: var(--fg-2);
          line-height: 1.2;
        }
        .vp-ftimer-bar {
          position: relative;
          height: 8px;
          background: var(--ink-3);
          border-radius: var(--r-full);
          overflow: hidden;
        }
        .vp-ftimer-bar-fill {
          position: absolute; top: 0; left: 0; bottom: 0;
          background: linear-gradient(90deg, var(--amber-lo), var(--amber));
          border-radius: var(--r-full);
          box-shadow: 0 0 8px var(--amber-glow);
          transition: width 0.6s var(--ease-out);
        }
        .vp-ftimer-bar-overrun {
          position: absolute; top: 0; bottom: 0; right: 0;
          background: repeating-linear-gradient(
            -45deg,
            var(--red) 0 4px,
            transparent 4px 8px
          );
          opacity: 0.7;
        }
        .vp-ftimer-bar-tick {
          position: absolute; top: 0; bottom: 0;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .vp-ftimer-bar-tick-line {
          width: 1.5px; height: 100%;
          background: var(--fg-1);
          opacity: 0.7;
        }
        .vp-ftimer-foot {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 6px;
          font-family: var(--font-mono);
          font-size: 9.5px;
          color: var(--fg-3);
          letter-spacing: 0.02em;
        }
        .vp-ftimer-foot .overrun { color: var(--red); font-weight: 600; }
      `}</style>
    </div>
  );
}

function formatHMS(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function formatHM(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}m`;
}

window.AircraftDetail = AircraftDetail;
window.FlightTimer = FlightTimer;
