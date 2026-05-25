// Ground report detail card — uses real Waze field shapes:
//   wazeUuid, type, subtype, street, city, reliability (1-10), confidence (1-10),
//   nThumbsUp, reportedAgo, lastConfirmedAgo.

function ReportDetail({ report, onClose }) {
  if (!report) return null;
  const distMi = computeDistance(report.x, report.y) / 1609;
  const bearing = computeBearing(report.x, report.y);
  const confirmed = report.nThumbsUp >= 5 && report.lastConfirmedAgo < 120;
  const decay = Math.max(0, Math.min(1, 1 - report.lastConfirmedAgo / 600));

  return (
    <div className="vp-detail vp-detail-report">
      <div className="vp-detail-head">
        <div className="vp-detail-ident">
          <div className="vp-detail-report-label">{labelForReport(report.kind)}</div>
          <div className="vp-detail-meta">
            <span>{report.street}, {report.city}</span>
          </div>
        </div>
        <button className="vp-detail-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="vp-detail-status-row">
        {confirmed ? (
          <span className="chip chip-confirm">
            <span className="dot dot-pulse" style={{ color: 'var(--green)' }} />
            {report.nThumbsUp}× CONFIRMED
          </span>
        ) : (
          <span className="chip chip-stale">{report.nThumbsUp} report{report.nThumbsUp !== 1 ? 's' : ''}</span>
        )}
        <span className="vp-detail-fresh num">last {formatSec(report.lastConfirmedAgo)} ago</span>
      </div>

      {/* Reliability + Confidence bars — Waze's source metrics */}
      <div className="vp-detail-quality">
        <QualityBar label="reliability" value={report.reliability} max={10} />
        <QualityBar label="confidence"  value={report.confidence}  max={10} />
        <QualityBar label="freshness"   value={Math.round(decay * 10)} max={10} tone="freshness" />
      </div>

      <div className="vp-detail-grid vp-detail-grid-3">
        <Metric label="distance" value={distMi.toFixed(1)} unit="mi" mono />
        <Metric label="bearing"  value={String(Math.round(bearing)).padStart(3, '0')} unit={`° ${compassFromBearing(bearing)}`} mono />
        <Metric label="reported" value={formatSec(report.reportedAgo)} unit="ago" mono />
      </div>

      <div className="vp-detail-source">
        <span className="t-label">Source</span>
        <span className="num">Waze · {report.wazeUuid}</span>
      </div>

      <style>{`
        .vp-detail-report-label {
          font-size: 20px; font-weight: 600;
          color: var(--fg-1);
          letter-spacing: -0.012em;
          line-height: 1;
        }
        .vp-detail-status-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
        }
        .vp-detail-fresh {
          font-size: 11px; color: var(--fg-3);
        }
        .vp-detail-quality {
          display: flex; flex-direction: column; gap: 8px;
          padding: 12px;
          background: var(--ink-2);
          border: 1px solid var(--border);
          border-radius: var(--r-md);
          margin-bottom: 14px;
        }
        .vp-detail-grid-3 {
          grid-template-columns: repeat(3, 1fr) !important;
        }
        .vp-detail-source {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--border-subtle);
          display: flex; align-items: center; justify-content: space-between;
          font-size: 11px;
          color: var(--fg-3);
        }
      `}</style>
    </div>
  );
}

function QualityBar({ label, value, max, tone = 'default' }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const color = tone === 'freshness' ? 'var(--green)' : 'var(--blue)';
  return (
    <div className="vp-q">
      <div className="vp-q-label">{label}</div>
      <div className="vp-q-bar">
        <div className="vp-q-bar-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <div className="vp-q-val num">{value}/{max}</div>
      <style>{`
        .vp-q { display: grid; grid-template-columns: 80px 1fr 36px; align-items: center; gap: 10px; }
        .vp-q-label {
          font-family: var(--font-mono);
          font-size: 9px; font-weight: 500;
          color: var(--fg-3);
          letter-spacing: 0.10em;
          text-transform: uppercase;
        }
        .vp-q-bar {
          height: 4px;
          background: var(--ink-3);
          border-radius: var(--r-full);
          overflow: hidden;
        }
        .vp-q-bar-fill {
          height: 100%;
          border-radius: var(--r-full);
        }
        .vp-q-val {
          font-size: 10px;
          color: var(--fg-2);
          text-align: right;
        }
      `}</style>
    </div>
  );
}

window.ReportDetail = ReportDetail;
window.QualityBar = QualityBar;
