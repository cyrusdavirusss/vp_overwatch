// VP-Overwatch — main app composition.
// Mobile-first, designed for 393x852 viewport (iPhone 16).
// Owns state for: theme, selection, scrub time, panel visibility, filters, map style.

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useMemo: useMemoA, useCallback: useCallbackA } = React;

function App(props) {
  // Load persisted tweaks from localStorage, falling back to props then defaults.
  const loadedTweaks = (() => {
    try { return JSON.parse(localStorage.getItem('vp-tweaks') || '{}'); }
    catch { return {}; }
  })();
  const t = {
    theme:         loadedTweaks.theme         || props.theme         || 'dark',
    mapStyle:      loadedTweaks.mapStyle      || props.mapStyle      || 'night',
    density:       loadedTweaks.density       || props.density       || 'comfortable',
    showPredictive: loadedTweaks.showPredictive ?? props.showPredictive ?? true,
    showTrails:    loadedTweaks.showTrails    ?? props.showTrails    ?? true,
    showHeatmap:   loadedTweaks.showHeatmap   ?? props.showHeatmap   ?? false,
  };

  // Onboarding disabled — the boot sequence delivers straight to the map.
  const [showOnboarding, setShowOnboarding] = useStateA(false);

  const [theme, setTheme] = useStateA(t.theme || 'dark');
  useEffectA(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // setTweak: persists key/value pairs to localStorage and syncs theme state.
  const setTweak = (update) => {
    try {
      const prev = JSON.parse(localStorage.getItem('vp-tweaks') || '{}');
      localStorage.setItem('vp-tweaks', JSON.stringify({ ...prev, ...update }));
    } catch {}
    if (update.theme) setTheme(update.theme);
  };

  const data = window.VP_DATA;
  const [scrubT, setScrubT] = useStateA(0);
  const [selectedAircraftId, setSelectedAircraftId] = useStateA(null);
  const [selectedReportId, setSelectedReportId] = useStateA(null);
  const [snap, setSnap] = useStateA('peek');
  const [filterOpen, setFilterOpen] = useStateA(false);
  const [followUser, setFollowUser] = useStateA(false);
  const [inspectPos, setInspectPos] = useStateA(null);
  const [focusTarget, setFocusTarget] = useStateA(null);
  const [now, setNow] = useStateA(Date.now());
  // relayTick counts seconds since the last relay poll. Resets to 0 each time
  // the poll interval elapses (mock: pollIntervalSec=60).
  const [relayTick, setRelayTick] = useStateA(data.RELAY.lastTickAgo);

  const [filters, setFilters] = useStateA({
    aircraft: true,
    reports: true,
    trails: t.showTrails,
    predictive: t.showPredictive,
    heatmap: t.showHeatmap,
    rotary: true,
    fixedwing: true,
    kind_marked: true,
    kind_unmarked: true,
    kind_hidden: true,
    kind_stop: true,
    kind_checkpoint: true,
    kind_rbt: true,
    kind_camera: true,
    radius: 8,
    windowMin: 60,
  });

  // Tick "now" so the clock advances; relay counter counts up then resets at pollIntervalSec.
  useEffectA(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setRelayTick(p => {
        const next = p + 1;
        return next >= data.RELAY.pollIntervalSec ? 0 : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Filter aircraft + reports
  const filteredAircraft = useMemoA(() => {
    return data.AIRCRAFT.filter(a => {
      if (!filters.aircraft) return false;
      if (a.role === 'rotary' && !filters.rotary) return false;
      if (a.role === 'fixedwing' && !filters.fixedwing) return false;
      return true;
    });
  }, [filters]);

  const filteredReports = useMemoA(() => {
    return data.REPORTS.filter(r => {
      if (!filters.reports) return false;
      if (r.kind === 'marked' && !filters.kind_marked) return false;
      if (r.kind === 'unmarked' && !filters.kind_unmarked) return false;
      if (r.kind === 'hidden' && !filters.kind_hidden) return false;
      if (r.kind === 'stop' && !filters.kind_stop) return false;
      if (r.kind === 'checkpoint' && !filters.kind_checkpoint) return false;
      if (r.kind === 'rbt' && !filters.kind_rbt) return false;
      if (r.kind === 'camera' && !filters.kind_camera) return false;
      return true;
    });
  }, [filters]);

  // Map dims — within the iPhone frame
  const MAP_W = 393;
  const SCREEN_H = 852;
  const STRIP_H = 110;        // 54px island clearance + 56px strip body
  const SCRUB_H = 96;
  const MAP_H = SCREEN_H - STRIP_H - SCRUB_H;

  // Container height for bottom sheet calculations
  const containerH = MAP_H;

  const onSelectAircraft = (id) => {
    setSelectedAircraftId(id);
    setSelectedReportId(null);
    if (id) {
      setSnap('half');
      const a = data.AIRCRAFT.find(x => x.id === id);
      if (a) {
        const pos = sampleTrack(a.track, scrubT);
        if (pos) setFocusTarget({ x: pos.x, y: pos.y });
      }
    }
  };
  const onSelectReport = (id) => {
    setSelectedReportId(id);
    setSelectedAircraftId(null);
    if (id) {
      setSnap('half');
      const r = data.REPORTS.find(x => x.id === id);
      if (r) setFocusTarget({ x: r.x, y: r.y });
    }
  };
  const onCloseDetail = () => {
    setSelectedAircraftId(null);
    setSelectedReportId(null);
  };

  const selectedAircraft = filteredAircraft.find(a => a.id === selectedAircraftId);
  const selectedReport   = filteredReports.find(r => r.id === selectedReportId);

  const onLongPress = (p) => setInspectPos(p);

  const onFilterChange = (f) => {
    setFilters(f);
    // Persist key visual toggles via tweaks
    setTweak({ showTrails: f.trails, showPredictive: f.predictive, showHeatmap: f.heatmap });
  };

  const onThemeToggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setTweak({ theme: next });
  };

  const onRecenter = () => {
    setFollowUser(true);
    setTimeout(() => setFollowUser(false), 100);
  };

  return (
    <div className="vp-app" style={{ width: MAP_W, height: SCREEN_H, position: 'relative', overflow: 'hidden', background: 'var(--ink-0)' }}>
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}
      <StatusStrip
        aircraftCount={filteredAircraft.filter(a => a.isActive !== false).length}
        silentCount={filteredAircraft.filter(a => a.isActive === false && a.lastSeen != null).length}
        reportsCount={filteredReports.length}
        scrubT={scrubT}
        relay={{ ...data.RELAY, lastTickAgo: relayTick }}
        theme={theme}
        onThemeToggle={onThemeToggle}
      />

      <div className="vp-map-host" style={{ position: 'absolute', top: STRIP_H, left: 0, right: 0, height: MAP_H }}>
        <VPMap
          width={MAP_W}
          height={MAP_H}
          aircraft={filteredAircraft}
          reports={filteredReports}
          user={data.USER}
          mapFeatures={data.MAP_FEATURES}
          selectedAircraftId={selectedAircraftId}
          selectedReportId={selectedReportId}
          onSelectAircraft={onSelectAircraft}
          onSelectReport={onSelectReport}
          onLongPress={onLongPress}
          scrubT={scrubT}
          layers={filters}
          mapStyle={t.mapStyle}
          theme={theme}
          followUser={followUser}
          focusTarget={focusTarget}
        />

        {/* Long-press inspect pin */}
        {inspectPos && (
          <InspectPin
            position={inspectPos}
            aircraft={filteredAircraft}
            reports={filteredReports}
            scrubT={scrubT}
            radius={filters.radius / 5}
            onClose={() => setInspectPos(null)}
          />
        )}

        {/* FAB cluster */}
        <FabCluster
          followUser={followUser}
          onLayers={() => setFilterOpen(v => !v)}
          onFilters={() => setFilterOpen(v => !v)}
          onRecenter={onRecenter}
          onInspect={() => setInspectPos({ x: 0, y: 0, sx: MAP_W / 2, sy: MAP_H / 2 })}
        />

        {/* Filter panel — overlay */}
        {filterOpen && (
          <div className="vp-filter-overlay" onClick={(e) => e.target === e.currentTarget && setFilterOpen(false)}>
            <FilterPanel
              filters={filters}
              onFilterChange={onFilterChange}
              mapStyle={t.mapStyle}
              onMapStyleChange={(v) => setTweak({ mapStyle: v })}
              onClose={() => setFilterOpen(false)}
            />
          </div>
        )}

        {/* Detail card stack — sits above sheet's peek when collapsed; inside sheet when expanded */}
        {/* Bottom sheet — always mounted; replaces feed body with the detail content when something is selected */}
        {!filterOpen && (
          <BottomSheet
            aircraft={filteredAircraft}
            reports={filteredReports}
            scrubT={scrubT}
            selectedAircraftId={selectedAircraftId}
            selectedReportId={selectedReportId}
            onSelectAircraft={onSelectAircraft}
            onSelectReport={onSelectReport}
            snap={snap}
            onSnapChange={setSnap}
            containerHeight={containerH}
            detailContent={
              selectedAircraft ? (
                <AircraftDetail aircraft={selectedAircraft} scrubT={scrubT} onClose={onCloseDetail} />
              ) : selectedReport ? (
                <ReportDetail report={selectedReport} onClose={onCloseDetail} />
              ) : null
            }
          />
        )}
      </div>

      <div className="vp-scrub-host" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: SCRUB_H }}>
        <TimeScrubber
          aircraft={data.AIRCRAFT}
          reports={data.REPORTS}
          value={scrubT}
          onChange={setScrubT}
          density={t.density}
        />
      </div>

      <style>{`
        .vp-app {
          font-family: var(--font-ui);
          color: var(--fg-1);
        }
        .vp-detail-host {
          position: absolute;
          left: 0; right: 0; bottom: 12px;
          z-index: var(--z-sheet);
        }
        .vp-filter-overlay {
          position: absolute;
          inset: 0;
          background: color-mix(in srgb, var(--ink-0) 60%, transparent);
          backdrop-filter: blur(4px);
          z-index: var(--z-modal);
          display: flex; align-items: flex-end;
          padding-bottom: 16px;
        }
      `}</style>
    </div>
  );
}

window.VPApp = App;
