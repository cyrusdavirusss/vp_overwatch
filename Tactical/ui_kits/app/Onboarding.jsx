// VP-Overwatch — onboarding.
// First-launch only. 4 screens. Operator-deadpan voice.
// State persists to localStorage; can be re-shown via Tweaks.

const { useState: useStateO, useEffect: useEffectO, useRef: useRefO } = React;

const VP_ONBOARD_KEY = 'vp-overwatch-onboarded';

function hasSeenOnboarding() {
  try { return localStorage.getItem(VP_ONBOARD_KEY) === '1'; } catch { return false; }
}
function markOnboarded() {
  try { localStorage.setItem(VP_ONBOARD_KEY, '1'); } catch {}
}
function clearOnboarded() {
  try { localStorage.removeItem(VP_ONBOARD_KEY); } catch {}
}

// ─── content ──────────────────────────────────────────────────────────────
const ONBOARD_PAGES = [
  {
    key: 'intro',
    eyebrow: 'V.1.0  ·  PRE-RELEASE',
    title: 'Two streams.\nOne map.',
    body: 'Law-enforcement aircraft and community ground reports, fused on a single live map. Public data only.',
    cta: 'Continue',
  },
  {
    key: 'air',
    eyebrow: 'STREAM 01  ·  AIR',
    title: 'ADS-B aircraft.',
    body: 'Surveillance helicopters and fixed-wing aircraft, by transponder. Position, altitude, heading, speed. Time-airborne measured against the unit\u2019s historical average.',
    cta: 'Continue',
  },
  {
    key: 'ground',
    eyebrow: 'STREAM 02  ·  GROUND',
    title: 'Community reports.',
    body: 'Marked, unmarked, and stationary units; checkpoints; speed cameras. Each report carries a confirmation count and a freshness timestamp. Stale reports decay.',
    cta: 'Continue',
  },
  {
    key: 'disclaimer',
    eyebrow: 'ACKNOWLEDGE',
    title: 'Situational awareness only.',
    body: 'VP-Overwatch surfaces public data. It is not navigation, not legal advice, and not a tool for evading lawful detention. Reports may be inaccurate or out of date. You are responsible for your own conduct.',
    cta: 'Acknowledge & enter',
  },
];

// ─── illustrations ───────────────────────────────────────────────────────
// Each is sized to occupy the upper third of the screen. JetBrains-Mono callouts.
function IntroIllo() {
  return (
    <div className="vp-ob-illo vp-ob-illo-intro">
      <div className="vp-ob-mark-stack">
        <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
          <defs>
            <radialGradient id="vpobGlow" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.18"/>
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="60" cy="60" r="58" fill="url(#vpobGlow)"/>
          <circle cx="60" cy="60" r="48" fill="none" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7"/>
          <circle cx="60" cy="60" r="32" fill="none" stroke="var(--border-strong)" strokeWidth="1"/>
          <path d="M 60 32 L 68 60 L 60 56 L 52 60 Z" fill="var(--amber)"/>
          <circle cx="60" cy="60" r="2.5" fill="var(--blue)"/>
          <path d="M 60 4 L 60 12 M 60 108 L 60 116 M 4 60 L 12 60 M 108 60 L 116 60"
                stroke="var(--fg-3)" strokeWidth="1.4" strokeLinecap="square"/>
        </svg>
      </div>
      <div className="vp-ob-stats">
        <div className="vp-ob-stat">
          <span className="vp-ob-stat-num num" style={{color:'var(--amber)'}}>12</span>
          <span className="vp-ob-stat-lab">AIRBORNE</span>
        </div>
        <div className="vp-ob-stat-sep" />
        <div className="vp-ob-stat">
          <span className="vp-ob-stat-num num" style={{color:'var(--red)'}}>47</span>
          <span className="vp-ob-stat-lab">GROUND</span>
        </div>
        <div className="vp-ob-stat-sep" />
        <div className="vp-ob-stat">
          <span className="vp-ob-stat-num num" style={{color:'var(--blue)'}}>1.4s</span>
          <span className="vp-ob-stat-lab">LATENCY</span>
        </div>
      </div>
    </div>
  );
}

function AirIllo() {
  return (
    <div className="vp-ob-illo">
      <svg viewBox="0 0 340 220" width="100%" height="220" aria-hidden="true" style={{display:'block'}}>
        {/* grid */}
        <defs>
          <pattern id="vpobGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0 L0 0 L0 20" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect x="0" y="0" width="340" height="220" fill="var(--ink-1)"/>
        <rect x="0" y="0" width="340" height="220" fill="url(#vpobGrid)"/>
        {/* track + predictive cone */}
        <path d="M 40 170 Q 100 150 150 130 T 230 90" fill="none" stroke="var(--amber)" strokeWidth="1.2" opacity="0.45" strokeDasharray="3 3"/>
        <path d="M 230 90 L 310 60 L 320 80 L 240 110 Z" fill="var(--amber)" opacity="0.12"/>
        {/* marker */}
        <g transform="translate(230 90)">
          <circle r="24" fill="var(--amber)" opacity="0.10"/>
          <circle r="14" fill="var(--amber)" opacity="0.18"/>
          <path d="M 0 -10 L 7 8 L 0 5 L -7 8 Z" fill="var(--amber)" transform="rotate(45)"/>
        </g>
        {/* callouts */}
        <g fontFamily="'JetBrains Mono', monospace" fontSize="9" fill="var(--fg-2)" letterSpacing="0.06em">
          <line x1="244" y1="90" x2="288" y2="60" stroke="var(--fg-4)" strokeWidth="0.5"/>
          <text x="290" y="59">REG  VH-PVH</text>
          <text x="290" y="71">ALT  1,250FT ↓</text>
          <line x1="220" y1="100" x2="170" y2="200" stroke="var(--fg-4)" strokeWidth="0.5"/>
          <text x="60" y="205">14M AIRBORNE  ·  AVG 42M</text>
        </g>
        {/* progress strip */}
        <rect x="60" y="190" width="180" height="3" rx="1.5" fill="var(--ink-3)"/>
        <rect x="60" y="190" width="60" height="3" rx="1.5" fill="var(--amber)"/>
        <line x1="180" y1="187" x2="180" y2="196" stroke="var(--fg-2)" strokeWidth="0.7"/>
      </svg>
    </div>
  );
}

function GroundIllo() {
  return (
    <div className="vp-ob-illo">
      <svg viewBox="0 0 340 220" width="100%" height="220" aria-hidden="true" style={{display:'block'}}>
        <defs>
          <pattern id="vpobGrid2" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0 L0 0 L0 20" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect x="0" y="0" width="340" height="220" fill="var(--ink-1)"/>
        <rect x="0" y="0" width="340" height="220" fill="url(#vpobGrid2)"/>
        {/* roads */}
        <path d="M 0 130 Q 120 120 200 140 T 340 130" fill="none" stroke="var(--ink-4)" strokeWidth="3"/>
        <path d="M 80 0 L 80 220" stroke="var(--ink-4)" strokeWidth="2" opacity="0.6"/>
        <path d="M 240 0 L 240 220" stroke="var(--ink-4)" strokeWidth="2" opacity="0.6"/>
        {/* threat marker — pulsing */}
        <g transform="translate(170 132)">
          <circle r="32" fill="var(--red)" opacity="0.06"/>
          <circle r="20" fill="var(--red)" opacity="0.10"/>
          <circle r="11" fill="var(--red)"/>
          <path d="M -3 -2 L 0 -5 L 3 -2 L 3 3 L -3 3 Z" fill="var(--ink-0)"/>
        </g>
        {/* stale marker */}
        <g transform="translate(72 70)" opacity="0.55">
          <circle r="9" fill="var(--stale)"/>
          <path d="M -3 0 L 0 -3 L 3 0 L 3 3 L -3 3 Z" fill="var(--ink-0)"/>
        </g>
        {/* callouts */}
        <g fontFamily="'JetBrains Mono', monospace" fontSize="9" fill="var(--fg-2)" letterSpacing="0.06em">
          <line x1="186" y1="124" x2="240" y2="68" stroke="var(--fg-4)" strokeWidth="0.5"/>
          <text x="243" y="60">HIDDEN UNIT</text>
          <text x="243" y="72" fill="var(--red)">4× CONFIRMED</text>
          <text x="243" y="84">47S AGO</text>
          <line x1="86" y1="78" x2="40" y2="200" stroke="var(--fg-4)" strokeWidth="0.5"/>
          <text x="20" y="208" fill="var(--stale)">STALE  ·  8M AGO</text>
        </g>
      </svg>
    </div>
  );
}

function DisclaimerIllo() {
  return (
    <div className="vp-ob-illo vp-ob-illo-disc">
      <svg viewBox="0 0 120 120" width="110" height="110" aria-hidden="true">
        <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-strong)" strokeWidth="1"/>
        <circle cx="60" cy="60" r="50" fill="none" stroke="var(--fg-3)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5"/>
        <path d="M 60 30 V 64 M 60 78 V 82" stroke="var(--fg-2)" strokeWidth="2.5" strokeLinecap="square"/>
      </svg>
      <div className="vp-ob-disc-stamp num">PUBLIC DATA  ·  NO TRACKING  ·  NO ACCOUNT</div>
    </div>
  );
}

const PAGE_ILLOS = [IntroIllo, AirIllo, GroundIllo, DisclaimerIllo];

// ─── main ────────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [page, setPage] = useStateO(0);
  const last = page === ONBOARD_PAGES.length - 1;
  const next = () => {
    if (last) {
      markOnboarded();
      onDone?.();
    } else {
      setPage(p => p + 1);
    }
  };
  const back = () => setPage(p => Math.max(0, p - 1));
  const skip = () => { markOnboarded(); onDone?.(); };

  const data = ONBOARD_PAGES[page];
  const Illo = PAGE_ILLOS[page];

  // keyboard
  useEffectO(() => {
    const fn = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { next(); }
      else if (e.key === 'ArrowLeft') { back(); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [page]);

  return (
    <div className="vp-ob" data-screen-label={`Onboarding ${String(page+1).padStart(2,'0')} ${data.key}`}>
      {/* top chrome — clear of island */}
      <div className="vp-ob-top">
        <div className="vp-ob-brand">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="var(--blue)" strokeWidth="1.2" opacity="0.5"/>
            <circle cx="12" cy="12" r="6.5" stroke="var(--blue)" strokeWidth="1.2" opacity="0.8"/>
            <path d="M12 6 L16.5 14.5 L12 12.5 L7.5 14.5 Z" fill="var(--amber)"/>
          </svg>
          <span className="vp-ob-brand-name">VP-OVERWATCH</span>
        </div>
        {!last && (
          <button className="vp-ob-skip" onClick={skip}>SKIP</button>
        )}
      </div>

      {/* illustration band */}
      <div className="vp-ob-illoband" key={page /* re-mount on change for fade */}>
        <Illo />
      </div>

      {/* copy */}
      <div className="vp-ob-copy" key={`copy-${page}`}>
        <div className="vp-ob-eyebrow num">{data.eyebrow}</div>
        <h1 className="vp-ob-title">{data.title}</h1>
        <p className="vp-ob-body">{data.body}</p>
      </div>

      {/* pager + ctas */}
      <div className="vp-ob-foot">
        <div className="vp-ob-pager" role="tablist" aria-label="Onboarding progress">
          {ONBOARD_PAGES.map((p, i) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={i === page}
              aria-label={`Step ${i+1} of ${ONBOARD_PAGES.length}`}
              className={`vp-ob-dot ${i === page ? 'is-active' : ''} ${i < page ? 'is-done' : ''}`}
              onClick={() => setPage(i)}
            />
          ))}
        </div>
        <div className="vp-ob-actions">
          {page > 0 && (
            <button className="vp-ob-btn vp-ob-btn-ghost" onClick={back}>
              <span aria-hidden="true">←</span> Back
            </button>
          )}
          <button className={`vp-ob-btn vp-ob-btn-primary ${last ? 'vp-ob-btn-ack' : ''}`} onClick={next}>
            {data.cta} <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="vp-ob-foot-meta num">
          STEP {String(page+1).padStart(2,'0')} / {String(ONBOARD_PAGES.length).padStart(2,'0')}
        </div>
      </div>

      <style>{`
        .vp-ob {
          position: absolute; inset: 0;
          background: var(--ink-0);
          color: var(--fg-1);
          display: flex; flex-direction: column;
          padding: 60px 22px 26px;
          box-sizing: border-box;
          z-index: 40;
          overflow: hidden;
        }
        .vp-ob::before {
          content: '';
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 80% 50% at 50% 0%, var(--blue-wash), transparent 70%),
            radial-gradient(ellipse 60% 40% at 50% 100%, var(--amber-wash), transparent 70%);
          opacity: 0.5;
          pointer-events: none;
        }
        .vp-ob > * { position: relative; }

        .vp-ob-top {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .vp-ob-brand {
          display: flex; align-items: center; gap: 8px;
        }
        .vp-ob-brand-name {
          font-family: var(--font-mono);
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.14em;
          color: var(--fg-1);
        }
        .vp-ob-skip {
          background: transparent; border: none;
          font-family: var(--font-mono);
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.14em;
          color: var(--fg-3);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: var(--r-sm);
          transition: color var(--dur-hover) var(--ease-out);
        }
        .vp-ob-skip:hover { color: var(--fg-1); }

        .vp-ob-illoband {
          flex: 0 0 auto;
          margin: 18px -4px 4px;
          display: flex; align-items: center; justify-content: center;
          animation: vp-ob-fade 360ms var(--ease-spring);
        }
        .vp-ob-illo {
          width: 100%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 14px;
        }
        .vp-ob-illo-intro { padding: 8px 0 0; }
        .vp-ob-illo-disc { padding: 18px 0 0; gap: 22px; }
        .vp-ob-mark-stack {
          filter: drop-shadow(0 6px 24px var(--blue-glow));
        }
        .vp-ob-stats {
          display: flex; align-items: center; gap: 14px;
          padding: 10px 16px;
          background: var(--ink-1);
          border: 1px solid var(--border);
          border-radius: var(--r-md);
        }
        .vp-ob-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 56px; }
        .vp-ob-stat-num { font-size: 18px; font-weight: 600; font-family: var(--font-mono); letter-spacing: -0.01em; line-height: 1; }
        .vp-ob-stat-lab {
          font-family: var(--font-mono);
          font-size: 8.5px; font-weight: 500;
          letter-spacing: 0.14em;
          color: var(--fg-3);
        }
        .vp-ob-stat-sep { width: 1px; height: 22px; background: var(--border); }
        .vp-ob-disc-stamp {
          font-size: 9.5px; font-weight: 500;
          letter-spacing: 0.18em;
          color: var(--fg-3);
          padding: 6px 12px;
          border: 1px solid var(--border);
          border-radius: var(--r-full);
        }

        .vp-ob-copy {
          flex: 1 1 auto;
          display: flex; flex-direction: column;
          padding: 20px 4px 12px;
          gap: 10px;
          animation: vp-ob-rise 380ms var(--ease-spring);
        }
        .vp-ob-eyebrow {
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.18em;
          color: var(--blue);
        }
        .vp-ob-title {
          margin: 0;
          font-family: var(--font-ui);
          font-size: 30px; font-weight: 600;
          line-height: 1.05;
          letter-spacing: -0.015em;
          color: var(--fg-1);
          white-space: pre-line;
          text-wrap: balance;
        }
        .vp-ob-body {
          margin: 0;
          font-family: var(--font-ui);
          font-size: 14px; font-weight: 400;
          line-height: 1.55;
          color: var(--fg-2);
          text-wrap: pretty;
          max-width: 32ch;
        }

        .vp-ob-foot {
          flex: 0 0 auto;
          display: flex; flex-direction: column;
          gap: 14px;
          padding-top: 12px;
        }
        .vp-ob-pager {
          display: flex; align-items: center; gap: 6px;
          padding: 0 2px;
        }
        .vp-ob-dot {
          width: 22px; height: 3px;
          background: var(--ink-3);
          border: none;
          border-radius: var(--r-full);
          padding: 0;
          cursor: pointer;
          transition: background var(--dur-hover) var(--ease-out), width var(--dur-panel) var(--ease-spring);
        }
        .vp-ob-dot.is-done { background: var(--blue-lo); }
        .vp-ob-dot.is-active { background: var(--blue); width: 32px; }

        .vp-ob-actions { display: flex; align-items: center; gap: 10px; }
        .vp-ob-btn {
          flex: 1;
          height: 48px;
          padding: 0 18px;
          border-radius: var(--r-md);
          font-family: var(--font-ui);
          font-size: 14px; font-weight: 500;
          letter-spacing: 0;
          border: 1px solid transparent;
          display: inline-flex; align-items: center; justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition:
            background var(--dur-hover) var(--ease-out),
            transform var(--dur-press) var(--ease-spring),
            border-color var(--dur-hover) var(--ease-out);
        }
        .vp-ob-btn:active { transform: scale(0.985); }
        .vp-ob-btn-primary {
          background: var(--blue); color: #fff;
          box-shadow: 0 6px 20px -8px var(--blue-glow);
        }
        .vp-ob-btn-primary:hover { background: var(--blue-hi); }
        .vp-ob-btn-ack {
          background: var(--amber); color: var(--ink-0);
          box-shadow: 0 6px 20px -8px var(--amber-glow);
        }
        .vp-ob-btn-ack:hover { background: var(--amber-hi); }
        .vp-ob-btn-ghost {
          flex: 0 0 auto;
          background: transparent;
          color: var(--fg-2);
          border-color: var(--border);
          padding: 0 14px;
        }
        .vp-ob-btn-ghost:hover { background: var(--ink-2); color: var(--fg-1); }

        .vp-ob-foot-meta {
          font-size: 9px; font-weight: 500;
          letter-spacing: 0.18em;
          color: var(--fg-4);
          text-align: center;
        }

        @keyframes vp-ob-fade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes vp-ob-rise {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

window.Onboarding = Onboarding;
window.VP_ONBOARD_KEY = VP_ONBOARD_KEY;
window.hasSeenOnboarding = hasSeenOnboarding;
window.markOnboarded = markOnboarded;
window.clearOnboarded = clearOnboarded;
