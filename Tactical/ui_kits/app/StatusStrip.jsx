// Top status strip — blurs over map.
// Shows: relay health · active aircraft · ground reports in radius · last update.

function StatusStrip({ aircraftCount, reportsCount, scrubT, relay, theme, onThemeToggle }) {
  const scrubbed = scrubT > 0;
  return (
    <div className="vp-strip">
      <div className="vp-strip-left">
        <div className="vp-strip-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--blue)" strokeWidth="1.2" opacity="0.4"/>
            <circle cx="12" cy="12" r="6.5" stroke="var(--blue)" strokeWidth="1.2" opacity="0.7"/>
            <path d="M12 6 L16.5 14.5 L12 12.5 L7.5 14.5 Z" fill="var(--amber)"/>
            <circle cx="12" cy="12" r="0.8" fill="var(--fg-1)"/>
          </svg>
        </div>
        <div className="vp-strip-id">
          <div className="vp-strip-title">VP-OVERWATCH</div>
          <div className="vp-strip-sub">
            <span style={{ color: relay.connected ? 'var(--blue)' : 'var(--red)' }}>
              <span className="dot dot-pulse" style={{ color: relay.connected ? 'var(--blue)' : 'var(--red)' }}></span>
            </span>
            <span className="vp-strip-sub-label">
              {scrubbed ? 'PLAYBACK' : (relay.connected ? 'LIVE' : 'OFFLINE')}
            </span>
            <span className="vp-strip-sub-meta num">· {scrubbed ? `−${formatSec(scrubT)}` : `${relay.lastTickAgo}s`}</span>
          </div>
        </div>
      </div>
      <div className="vp-strip-stats">
        <Stat n={aircraftCount} label="airborne" tone="amber" />
        <Stat n={reportsCount} label="ground"   tone="red" />
        <button className="vp-strip-theme" onClick={onThemeToggle} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
      </div>

      <style>{`
        .vp-strip {
          position: absolute; top: 0; left: 0; right: 0;
          height: 56px;
          padding: 8px 14px 0;
          padding-top: 54px;  /* clear the iPhone dynamic island */
          box-sizing: content-box;
          display: flex; align-items: center; justify-content: space-between;
          background: color-mix(in srgb, var(--ink-1) 78%, transparent);
          backdrop-filter: blur(18px) saturate(140%);
          -webkit-backdrop-filter: blur(18px) saturate(140%);
          border-bottom: 1px solid var(--border-subtle);
          z-index: var(--z-overlay);
        }
        .vp-strip-left { display: flex; align-items: center; gap: 10px; }
        .vp-strip-mark {
          width: 32px; height: 32px;
          display: flex; align-items: center; justify-content: center;
          background: var(--ink-2); border: 1px solid var(--border);
          border-radius: var(--r-md);
        }
        .vp-strip-id { display: flex; flex-direction: column; gap: 2px; }
        .vp-strip-title {
          font-family: var(--font-mono);
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.10em;
          color: var(--fg-1);
          line-height: 1;
        }
        .vp-strip-sub {
          display: flex; align-items: center; gap: 5px;
          font-family: var(--font-mono);
          font-size: 9.5px; font-weight: 500;
          letter-spacing: 0.06em;
          line-height: 1;
          color: var(--fg-3);
        }
        .vp-strip-sub-label { letter-spacing: 0.10em; text-transform: uppercase; }
        .vp-strip-sub-meta { color: var(--fg-3); }
        .vp-strip-stats { display: flex; align-items: center; gap: 6px; }
        .vp-strip-theme {
          width: 32px; height: 32px;
          margin-left: 6px;
          background: var(--ink-2);
          border: 1px solid var(--border);
          color: var(--fg-2);
          border-radius: var(--r-md);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background var(--dur-hover) var(--ease-out);
        }
        .vp-strip-theme:hover { background: var(--ink-3); color: var(--fg-1); }
      `}</style>
    </div>
  );
}

function Stat({ n, label, tone }) {
  return (
    <div className="vp-stat">
      <div className={`vp-stat-num vp-stat-${tone}`}>{String(n).padStart(2, '0')}</div>
      <div className="vp-stat-label">{label}</div>
      <style>{`
        .vp-stat { display: flex; align-items: baseline; gap: 4px; padding: 0 4px; }
        .vp-stat-num {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          font-size: 16px; font-weight: 600;
          line-height: 1;
        }
        .vp-stat-amber { color: var(--amber); }
        .vp-stat-red { color: var(--red); }
        .vp-stat-blue { color: var(--blue); }
        .vp-stat-label {
          font-family: var(--font-mono);
          font-size: 9.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--fg-3);
          line-height: 1;
        }
      `}</style>
    </div>
  );
}

function formatSec(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

window.StatusStrip = StatusStrip;
window.formatSec = formatSec;
