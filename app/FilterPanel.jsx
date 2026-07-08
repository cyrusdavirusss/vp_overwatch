// Filter & Layer panel — a single dense control surface.
// No nested menus. Toggles for layers, aircraft types, report types, radius, window.

function FilterPanel({
  filters, onFilterChange,
  mapStyle, onMapStyleChange,
  onClose,
}) {

  const toggle = (key) => () => onFilterChange({ ...filters, [key]: !filters[key] });
  const setKey = (key, v) => onFilterChange({ ...filters, [key]: v });

  return (
    <div className="vp-filter">
      <div className="vp-filter-head">
        <div className="vp-filter-title">
          <Icon name="layers" size={16} />
          <span>Layers &amp; Filters</span>
        </div>
        <button className="vp-detail-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>

      <Section label="Layers">
        <ToggleRow label="Aircraft" sub="ADS-B feed"     checked={filters.aircraft}  onChange={toggle('aircraft')} />
        <ToggleRow label="Ground reports" sub="Waze pipeline" checked={filters.reports}   onChange={toggle('reports')} />
        <ToggleRow label="Aircraft trails" sub="fading 4m" checked={filters.trails}    onChange={toggle('trails')} />
        <ToggleRow label="Predictive vector" sub="60–90s forward" checked={filters.predictive} onChange={toggle('predictive')} />
        <ToggleRow label="Heatmap"  sub="historical density"  checked={filters.heatmap}   onChange={toggle('heatmap')} />
      </Section>

      <Section label="Aircraft types">
        <ChipRow>
          <ChipToggle active={filters.rotary}    onClick={() => setKey('rotary', !filters.rotary)}><Icon name="helicopter" size={12} stroke={1.5} /> Rotary</ChipToggle>
          <ChipToggle active={filters.fixedwing} onClick={() => setKey('fixedwing', !filters.fixedwing)}><Icon name="plane" size={12} stroke={1.5} /> Fixed-wing</ChipToggle>
        </ChipRow>
      </Section>

      <Section label="Report types">
        <ChipRow>
          <ChipToggle active={filters.kind_marked}     onClick={() => setKey('kind_marked', !filters.kind_marked)}>Marked</ChipToggle>
          <ChipToggle active={filters.kind_unmarked}   onClick={() => setKey('kind_unmarked', !filters.kind_unmarked)}>Unmarked</ChipToggle>
          <ChipToggle active={filters.kind_hidden}     onClick={() => setKey('kind_hidden', !filters.kind_hidden)}>Hidden</ChipToggle>
          <ChipToggle active={filters.kind_stop}       onClick={() => setKey('kind_stop', !filters.kind_stop)}>Stop</ChipToggle>
          <ChipToggle active={filters.kind_checkpoint} onClick={() => setKey('kind_checkpoint', !filters.kind_checkpoint)}>Checkpoint</ChipToggle>
          <ChipToggle active={filters.kind_rbt}        onClick={() => setKey('kind_rbt', !filters.kind_rbt)}>RBT</ChipToggle>
          <ChipToggle active={filters.kind_camera}     onClick={() => setKey('kind_camera', !filters.kind_camera)}>Camera</ChipToggle>
        </ChipRow>
      </Section>

      <Section label="Map style">
        <ChipRow>
          <ChipToggle active={mapStyle === 'night'}   onClick={() => onMapStyleChange('night')}>Navigation Night</ChipToggle>
          <ChipToggle active={mapStyle === 'toner'}   onClick={() => onMapStyleChange('toner')}>Toner Mono</ChipToggle>
          <ChipToggle active={mapStyle === 'terrain'} onClick={() => onMapStyleChange('terrain')}>Hypsometric</ChipToggle>
        </ChipRow>
      </Section>

      <Section label="Radius">
        <SliderRow
          label={`${filters.radius}nm`}
          min={1} max={25} step={1}
          value={filters.radius}
          onChange={(v) => setKey('radius', v)}
        />
      </Section>

      <Section label="Time window">
        <ChipRow>
          {[15, 30, 60, 120].map(m => (
            <ChipToggle key={m} active={filters.windowMin === m} onClick={() => setKey('windowMin', m)}>
              {m}m
            </ChipToggle>
          ))}
        </ChipRow>
      </Section>

      <style>{`
        .vp-filter {
          background: var(--ink-1);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          padding: 14px 16px 18px;
          margin: 0 12px;
          max-height: calc(100% - 88px);
          overflow-y: auto;
          box-shadow: var(--shadow-panel);
        }
        .vp-filter-head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .vp-filter-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 14px; font-weight: 600;
          color: var(--fg-1);
          letter-spacing: -0.005em;
        }
        .vp-section { margin-bottom: 16px; }
        .vp-section-label {
          font-family: var(--font-mono);
          font-size: 9px; font-weight: 500;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          color: var(--fg-3);
          margin-bottom: 8px;
        }
      `}</style>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="vp-section">
      <div className="vp-section-label">{label}</div>
      {children}
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange }) {
  return (
    <div className="vp-toggle-row" onClick={onChange}>
      <div className="vp-toggle-text">
        <div className="vp-toggle-label">{label}</div>
        <div className="vp-toggle-sub">{sub}</div>
      </div>
      <Switch checked={checked} />
      <style>{`
        .vp-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: background var(--dur-hover) var(--ease-out);
        }
        .vp-toggle-row:last-child { border-bottom: none; }
        .vp-toggle-row:hover { background: var(--ink-2); border-radius: var(--r-sm); margin: 0 -8px; padding-left: 8px; padding-right: 8px; }
        .vp-toggle-text { display: flex; flex-direction: column; gap: 2px; }
        .vp-toggle-label { font-size: 13px; color: var(--fg-1); }
        .vp-toggle-sub {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--fg-3);
          letter-spacing: 0.02em;
        }
      `}</style>
    </div>
  );
}

function Switch({ checked }) {
  return (
    <div className={`vp-switch ${checked ? 'is-on' : ''}`}>
      <div className="vp-switch-thumb" />
      <style>{`
        .vp-switch {
          width: 32px; height: 18px;
          border-radius: var(--r-full);
          background: var(--ink-3);
          position: relative;
          transition: background var(--dur-hover) var(--ease-out);
          flex-shrink: 0;
        }
        .vp-switch.is-on { background: var(--blue); }
        .vp-switch-thumb {
          position: absolute; top: 2px; left: 2px;
          width: 14px; height: 14px;
          background: #fff;
          border-radius: 50%;
          transition: left var(--dur-hover) var(--ease-spring);
        }
        .vp-switch.is-on .vp-switch-thumb { left: 16px; }
      `}</style>
    </div>
  );
}

function ChipRow({ children }) {
  return (
    <div className="vp-chip-row">
      {children}
      <style>{`
        .vp-chip-row {
          display: flex; flex-wrap: wrap; gap: 6px;
        }
      `}</style>
    </div>
  );
}

function ChipToggle({ active, onClick, children }) {
  return (
    <button className={`vp-chip-tg ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
      <style>{`
        .vp-chip-tg {
          display: inline-flex; align-items: center; gap: 5px;
          height: 28px;
          padding: 0 11px;
          border-radius: var(--r-full);
          background: var(--ink-2);
          border: 1px solid var(--border);
          color: var(--fg-2);
          font-family: var(--font-ui);
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background var(--dur-hover) var(--ease-out),
                      color var(--dur-hover) var(--ease-out),
                      border-color var(--dur-hover) var(--ease-out);
        }
        .vp-chip-tg:hover { background: var(--ink-3); color: var(--fg-1); }
        .vp-chip-tg.is-active {
          background: var(--blue-wash);
          border-color: var(--blue);
          color: var(--blue);
        }
      `}</style>
    </button>
  );
}

function SliderRow({ label, min, max, step, value, onChange }) {
  return (
    <div className="vp-slider">
      <div className="vp-slider-track">
        <div className="vp-slider-fill" style={{ width: `${((value - min) / (max - min)) * 100}%` }} />
        <input
          type="range"
          min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <span className="vp-slider-label num">{label}</span>
      <style>{`
        .vp-slider {
          display: flex; align-items: center; gap: 12px;
          padding: 4px 0;
        }
        .vp-slider-track {
          flex: 1;
          position: relative;
          height: 4px;
          background: var(--ink-3);
          border-radius: var(--r-full);
        }
        .vp-slider-fill {
          position: absolute; top: 0; left: 0; bottom: 0;
          background: var(--blue);
          border-radius: var(--r-full);
        }
        .vp-slider-track input[type=range] {
          position: absolute; inset: -10px 0;
          width: 100%; height: 24px;
          opacity: 0;
          cursor: pointer;
        }
        .vp-slider-label {
          font-size: 12px; font-weight: 600;
          color: var(--fg-1);
          letter-spacing: 0.02em;
          min-width: 40px;
          text-align: right;
        }
      `}</style>
    </div>
  );
}

window.FilterPanel = FilterPanel;
