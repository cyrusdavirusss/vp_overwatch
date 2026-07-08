// ===== VP-Overwatch bundled app (concatenated for single x-import) =====

// ----- data.js -----
// Mock data for VP-Overwatch prototype.
// Field shapes ALIGN WITH lib/db schemas and lib/api-zod types:
//   - Aircraft: hex, registration, callsign, startTime, timeAirborneSeconds,
//     estimatedReturnSeconds, historicalAverageSeconds, lat/lng (synthetic x/y in this mock),
//     altitude, speed, track.
//   - Waze alerts: wazeUuid, type, subtype, lat/lng, street, city, reliability,
//     confidence, nThumbsUp, reportedAt, lastSeenAt, expiresAt.
// Geographic context: Victoria, Australia (Melbourne metro).
//
// Coordinates here are synthetic local meters with origin = Melbourne CBD,
// rendered by the canvas map; the production app will use real lat/lng with MapLibre.

window.VP_DATA = (() => {

  const NOW = Date.now();

  const AIRCRAFT = [
    {
      hex: '7C7F8C',
      registration: 'VH-PVH',
      callsign: 'POL61',
      type: 'AW139',
      typeLabel: 'AgustaWestland AW139',
      role: 'rotary',
      operator: 'VicPol Air Wing',
      operatorShort: 'VPAW',
      // Flight timing (the brief's missed feature):
      startTime: NOW - 14 * 60 * 1000,        // 14 minutes ago
      timeAirborneSeconds: 14 * 60,
      historicalAverageSeconds: 42 * 60,      // avg flight = 42m
      estimatedReturnSeconds: 28 * 60,        // 28m predicted remaining
      // Latest live position
      altitude: 1250, speed: 78, track: 85,
      latitude: -37.81, longitude: 144.96,
      track_history: generateTrack({ startX: -1200, startY: -600, vx: 38, vy: 12, alt: 1250, hdg: 85, spd: 78, minutes: 14, curveBias: 0.15 }),
    },
    {
      hex: '7C2B22',
      registration: 'VH-PVI',
      callsign: 'POL64',
      type: 'EC135',
      typeLabel: 'Eurocopter EC135',
      role: 'rotary',
      operator: 'VicPol Air Wing',
      operatorShort: 'VPAW',
      startTime: NOW - 9 * 60 * 1000,
      timeAirborneSeconds: 9 * 60,
      historicalAverageSeconds: 35 * 60,
      estimatedReturnSeconds: 26 * 60,
      altitude: 900, speed: 64, track: 232,
      latitude: -37.79, longitude: 145.02,
      track_history: generateTrack({ startX: 2400, startY: 1800, vx: -22, vy: -28, alt: 900, hdg: 232, spd: 64, minutes: 9, curveBias: -0.25, orbit: { x: 1200, y: 800, r: 600 } }),
    },
    {
      hex: '7CF102',
      registration: 'VH-AFC',
      callsign: 'AFP21',
      type: 'C208',
      typeLabel: 'Cessna 208 Caravan',
      role: 'fixedwing',
      operator: 'Australian Federal Police',
      operatorShort: 'AFP',
      startTime: NOW - 18 * 60 * 1000,
      timeAirborneSeconds: 18 * 60,
      historicalAverageSeconds: 95 * 60,      // fixed-wing has longer avg
      estimatedReturnSeconds: 77 * 60,
      altitude: 2800, speed: 112, track: 145,
      latitude: -37.91, longitude: 144.83,
      track_history: generateTrack({ startX: -3800, startY: 3200, vx: 55, vy: -40, alt: 2800, hdg: 145, spd: 112, minutes: 18, curveBias: 0.05 }),
    },
    {
      hex: '7C1F40',
      registration: 'VH-PVK',
      callsign: 'POL67',
      type: 'AW139',
      typeLabel: 'AgustaWestland AW139',
      role: 'rotary',
      operator: 'VicPol Air Wing',
      operatorShort: 'VPAW',
      startTime: NOW - 6 * 60 * 1000,
      timeAirborneSeconds: 6 * 60,
      historicalAverageSeconds: 38 * 60,
      estimatedReturnSeconds: 32 * 60,
      altitude: 1100, speed: 70, track: 312,
      latitude: -37.70, longitude: 145.18,
      track_history: generateTrack({ startX: 4500, startY: -2200, vx: -30, vy: 35, alt: 1100, hdg: 312, spd: 70, minutes: 6, curveBias: 0.3 }),
    },
    {
      hex: '7C4D8B',
      registration: 'VH-AAP',
      callsign: 'AAP-OPS',
      type: 'BE350',
      typeLabel: 'Beechcraft King Air 350',
      role: 'fixedwing',
      operator: 'Aviation Australia Police',
      operatorShort: 'AAP',
      startTime: NOW - 11 * 60 * 1000,
      timeAirborneSeconds: 11 * 60,
      historicalAverageSeconds: 78 * 60,
      estimatedReturnSeconds: 67 * 60,
      altitude: 4500, speed: 145, track: 55,
      latitude: -37.95, longitude: 144.66,
      track_history: generateTrack({ startX: -4200, startY: -3000, vx: 15, vy: 22, alt: 4500, hdg: 55, spd: 145, minutes: 11, curveBias: 0.1 }),
    },
  ];

  function generateTrack({ startX, startY, vx, vy, alt, hdg, spd, minutes, curveBias = 0, orbit = null }) {
    const points = [];
    const totalSeconds = minutes * 60;
    const dt = 4;
    const samples = Math.floor(totalSeconds / dt);
    let cx = startX, cy = startY;
    let cHdg = hdg, cAlt = alt, cSpd = spd;
    let theta = 0;
    for (let i = 0; i < samples; i++) {
      const t = i * dt;
      if (orbit) {
        theta += 0.08;
        cx = orbit.x + Math.cos(theta) * orbit.r;
        cy = orbit.y + Math.sin(theta) * orbit.r;
        cHdg = ((theta * 180 / Math.PI) + 90) % 360;
      } else {
        cx += vx * (dt / 60);
        cy += vy * (dt / 60);
        cHdg = (cHdg + curveBias) % 360;
      }
      cAlt += (Math.sin(i * 0.3) * 8);
      cSpd += (Math.sin(i * 0.5) * 1.2);
      const vsign = (Math.sin(i * 0.3) > 0) ? 1 : -1;
      points.push({
        t: t - totalSeconds,
        x: cx, y: cy,
        alt: Math.round(cAlt),
        hdg: Math.round(((cHdg % 360) + 360) % 360),
        spd: Math.round(cSpd * 10) / 10,
        vs: Math.round(vsign * (Math.abs(Math.sin(i * 0.3)) * 200)),
      });
    }
    return points.reverse();
  }

  // Ground reports (Waze alerts) — fields match wazeAlertsTable schema.
  // type: POLICE | ACCIDENT | HAZARD | JAM | ROAD_CLOSED
  // subtype (for POLICE): POLICE_VISIBLE | POLICE_HIDDEN | (and our app-level: marked/unmarked/stop/checkpoint)
  const REPORTS = [
    { wazeUuid: 'wz-3f8a-001', type: 'POLICE', subtype: 'POLICE_VISIBLE',  kind: 'marked',     x:  -800,  y:  400, street: 'Hoddle St',     city: 'Abbotsford',   reliability: 8, confidence: 7,  nThumbsUp: 7,  reportedAgo: 423,  lastConfirmedAgo: 12 },
    { wazeUuid: 'wz-3f8a-002', type: 'POLICE', subtype: 'POLICE_HIDDEN',   kind: 'hidden',     x:  1200,  y: -200, street: 'Princes Hwy',   city: 'St Kilda East', reliability: 9, confidence: 8, nThumbsUp: 12, reportedAgo: 580,  lastConfirmedAgo: 47 },
    { wazeUuid: 'wz-3f8a-003', type: 'POLICE', subtype: null,              kind: 'unmarked',   x: -2200,  y:  1400, street: 'Sydney Rd',     city: 'Brunswick',    reliability: 6, confidence: 6,  nThumbsUp: 3,  reportedAgo: 240,  lastConfirmedAgo: 88 },
    { wazeUuid: 'wz-3f8a-004', type: 'POLICE', subtype: 'ROADSIDE_STOP',   kind: 'stop',       x:   300,  y: -1800, street: 'M1 Monash Fwy', city: 'Glen Iris',    reliability: 7, confidence: 7,  nThumbsUp: 5,  reportedAgo: 156,  lastConfirmedAgo: 28 },
    { wazeUuid: 'wz-3f8a-005', type: 'POLICE', subtype: 'CHECKPOINT',      kind: 'checkpoint', x:  2200,  y:   600, street: 'Burnley Tnl',   city: 'Burnley',      reliability: 10, confidence: 9, nThumbsUp: 21, reportedAgo: 1800, lastConfirmedAgo: 65 },
    { wazeUuid: 'wz-3f8a-006', type: 'POLICE', subtype: 'POLICE_VISIBLE',  kind: 'marked',     x: -1500,  y: -1200, street: 'Heidelberg Rd', city: 'Fairfield',    reliability: 6, confidence: 6,  nThumbsUp: 4,  reportedAgo: 95,   lastConfirmedAgo: 95 },
    { wazeUuid: 'wz-3f8a-007', type: 'POLICE', subtype: 'POLICE_HIDDEN',   kind: 'hidden',     x:  3400,  y:  2400, street: 'Eastlink',      city: 'Donvale',      reliability: 8, confidence: 8,  nThumbsUp: 8,  reportedAgo: 720,  lastConfirmedAgo: 120 },
    { wazeUuid: 'wz-3f8a-008', type: 'POLICE', subtype: 'POLICE_VISIBLE',  kind: 'marked',     x: -3000,  y:  -400, street: 'Hume Hwy',      city: 'Craigieburn',  reliability: 5, confidence: 5,  nThumbsUp: 2,  reportedAgo: 40,   lastConfirmedAgo: 40 },
    { wazeUuid: 'wz-3f8a-009', type: 'POLICE', subtype: null,              kind: 'unmarked',   x:  1600,  y:  2200, street: 'Toorak Rd',     city: 'South Yarra',  reliability: 4, confidence: 4,  nThumbsUp: 2,  reportedAgo: 380,  lastConfirmedAgo: 380 },
    { wazeUuid: 'wz-3f8a-010', type: 'POLICE', subtype: 'ROADSIDE_STOP',   kind: 'stop',       x: -2800,  y: -2600, street: 'M3 Eastern Fwy', city: 'Kew',         reliability: 9, confidence: 8,  nThumbsUp: 9,  reportedAgo: 210,  lastConfirmedAgo: 18 },
    { wazeUuid: 'wz-3f8a-011', type: 'POLICE', subtype: 'RBT',             kind: 'rbt',        x:   900,  y: -800,  street: 'Punt Rd',       city: 'Richmond',     reliability: 9, confidence: 9,  nThumbsUp: 14, reportedAgo: 480,  lastConfirmedAgo: 22 },
    { wazeUuid: 'wz-3f8a-012', type: 'POLICE', subtype: 'RBT',             kind: 'rbt',        x: -1900,  y:  2800, street: 'CityLink',      city: 'Carlton',      reliability: 8, confidence: 8,  nThumbsUp: 11, reportedAgo: 920,  lastConfirmedAgo: 55 },
    { wazeUuid: 'wz-3f8a-013', type: 'CAMERA', subtype: 'SPEED_CAMERA',    kind: 'camera',     x:  2800,  y: -2400, street: 'EastLink',      city: 'Frankston',    reliability: 10, confidence: 10, nThumbsUp: 38, reportedAgo: 12000, lastConfirmedAgo: 728 },
    { wazeUuid: 'wz-3f8a-014', type: 'CAMERA', subtype: 'RED_LIGHT',       kind: 'camera',     x:  -600,  y:  2900, street: 'Flemington Rd', city: 'North Melbourne', reliability: 10, confidence: 10, nThumbsUp: 47, reportedAgo: 24000, lastConfirmedAgo: 1080 },
    { wazeUuid: 'wz-3f8a-015', type: 'CAMERA', subtype: 'SPEED_CAMERA',    kind: 'camera',     x:  4200,  y:  1200, street: 'Maroondah Hwy', city: 'Ringwood',     reliability: 10, confidence: 10, nThumbsUp: 29, reportedAgo: 8400,  lastConfirmedAgo: 412 },
  ];

  const USER = { x: 0, y: 0, hdg: 32, accuracy: 25, latitude: -37.81, longitude: 144.96 };

  const RELAY = {
    connected: true,
    lastTickAgo: 23,
    pollIntervalSec: 60,
    lastIngested: 87,
    lastRaw: 142,
    coverageRegions: 6,
  };

  const MAP_FEATURES = generateMapFeatures();

  function generateMapFeatures() {
    let seed = 42;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const roads = { arterials: [], locals: [], highways: [] };
    const water = [];
    const parks = [];

    const hwy = [];
    for (let i = -100; i <= 100; i += 2) {
      const t = i / 100;
      hwy.push({ x: t * 8000 + Math.sin(t * 1.8) * 300, y: t * 5500 - Math.cos(t * 1.4) * 400 - 1200 });
    }
    roads.highways.push(hwy);

    const hwy2 = [];
    for (let i = -100; i <= 100; i += 2) {
      const t = i / 100;
      hwy2.push({ x: t * 5500 + Math.cos(t * 1.2) * 400 + 1800, y: t * 8000 - Math.sin(t * 1.6) * 300 });
    }
    roads.highways.push(hwy2);

    for (let i = -4; i <= 4; i++) {
      const x = i * 1500 + (rnd() - 0.5) * 200;
      const line = [];
      for (let y = -5500; y <= 5500; y += 250) line.push({ x: x + Math.sin(y * 0.0008) * 80, y });
      roads.arterials.push(line);
    }
    for (let i = -4; i <= 4; i++) {
      const y = i * 1500 + (rnd() - 0.5) * 200;
      const line = [];
      for (let x = -5500; x <= 5500; x += 250) line.push({ x, y: y + Math.cos(x * 0.0008) * 80 });
      roads.arterials.push(line);
    }

    for (let i = 0; i < 90; i++) {
      const cx = (rnd() - 0.5) * 10000;
      const cy = (rnd() - 0.5) * 10000;
      const horizontal = rnd() > 0.5;
      const length = 400 + rnd() * 800;
      const line = [];
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const u = (s / steps - 0.5) * length;
        line.push({
          x: cx + (horizontal ? u : (rnd() - 0.5) * 30),
          y: cy + (horizontal ? (rnd() - 0.5) * 30 : u),
        });
      }
      roads.locals.push(line);
    }

    const river = [];
    for (let i = -60; i <= 60; i += 1) {
      const t = i / 60;
      river.push({ x: t * 8000 + Math.sin(t * 3.2) * 800 - 1500, y: t * 4000 + Math.cos(t * 2.4) * 600 + 2200 });
    }
    water.push({ kind: 'river', points: river, width: 320 });

    parks.push(polygon(2800, -1800, 800, 600, 5));
    parks.push(polygon(-3200, 2400, 1100, 700, 7));
    parks.push(polygon(-200, 3600, 600, 450, 6));
    parks.push(polygon(3800, 3200, 500, 500, 6));

    function polygon(cx, cy, w, h, n) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({
          x: cx + Math.cos(a) * (w / 2) * (0.8 + rnd() * 0.4),
          y: cy + Math.sin(a) * (h / 2) * (0.8 + rnd() * 0.4),
        });
      }
      return pts;
    }
    return { roads, water, parks };
  }

  // Helper used by the existing map renderer (expects `.track` array on each aircraft)
  AIRCRAFT.forEach(a => { a.track = a.track_history; a.id = a.hex; a.icao = a.hex; });
  // Helper for reports — keep id, descr (built from street/city), confirmations (alias for nThumbsUp), source
  REPORTS.forEach((r, i) => {
    r.id = `r-${String(i + 1).padStart(3, '0')}`;
    r.descr = `${labelForKind(r.kind)}, ${r.street}`;
    r.confirmations = r.nThumbsUp;
    r.source = 'waze';
  });

  function labelForKind(kind) {
    switch (kind) {
      case 'marked': return 'Marked unit';
      case 'unmarked': return 'Unmarked';
      case 'hidden': return 'Hidden unit';
      case 'stop': return 'Roadside stop';
      case 'checkpoint': return 'Checkpoint';
      case 'rbt': return 'RBT';
      case 'camera': return 'Camera';
      default: return 'Police';
    }
  }

  return { AIRCRAFT, REPORTS, USER, MAP_FEATURES, RELAY, NOW };
})();


// ----- Icon.jsx -----
// Lucide-style icons, inline SVG, currentColor.
// Stroke 1.75 for tighter optical balance at small sizes.
// Usage: <Icon name="layers" size={18} />

const ICON_PATHS = {
  layers: 'M12 2 L2 7 L12 12 L22 7 Z M2 12 L12 17 L22 12 M2 17 L12 22 L22 17',
  filter: 'M3 6 H21 M6 12 H18 M10 18 H14',
  crosshair: 'M12 22 V18 M12 6 V2 M22 12 H18 M6 12 H2 M19 12 A7 7 0 1 1 12 5 A7 7 0 0 1 19 12',
  navigation: 'M3 11 L22 2 L13 21 L11 13 Z',
  chevronUp: 'M6 15 L12 9 L18 15',
  chevronDown: 'M6 9 L12 15 L18 9',
  chevronLeft: 'M15 18 L9 12 L15 6',
  chevronRight: 'M9 18 L15 12 L9 6',
  close: 'M18 6 L6 18 M6 6 L18 18',
  search: 'M11 19 A8 8 0 1 1 19 11 A8 8 0 0 1 11 19 Z M21 21 L16.65 16.65',
  radio: 'M4.93 19.07 A10 10 0 0 1 4.93 4.93 M7.76 16.24 A6 6 0 0 1 7.76 7.76 M19.07 4.93 A10 10 0 0 1 19.07 19.07 M16.24 7.76 A6 6 0 0 1 16.24 16.24 M12 13 A1 1 0 1 0 12 11 A1 1 0 0 0 12 13 Z',
  alert: 'M12 9 V13 M12 17 H12.01 M10.29 3.86 L1.82 18 A2 2 0 0 0 3.55 21 H20.45 A2 2 0 0 0 22.18 18 L13.71 3.86 A2 2 0 0 0 10.29 3.86 Z',
  helicopter: 'M5 8 H19 M12 8 V14 M9 14 H15 M7 17 H17 M11 14 V17 M13 14 V17 M12 5 V8',
  plane: 'M17.8 19.2 L16 11 L8.59 12.42 M21 8 L7 22 L6 11 L4 9 V5 L21 8 Z',
  car: 'M19 17 H5 V13 L7 7 H17 L19 13 Z M7.5 17 V19 M16.5 17 V19 M5 13 H19',
  eye: 'M2 12 S5 5 12 5 S22 12 22 12 S19 19 12 19 S2 12 2 12 Z M15 12 A3 3 0 1 1 12 9 A3 3 0 0 1 15 12',
  pause: 'M6 4 H10 V20 H6 Z M14 4 H18 V20 H14 Z',
  play: 'M5 3 L19 12 L5 21 Z',
  clock: 'M12 22 A10 10 0 1 1 22 12 A10 10 0 0 1 12 22 Z M12 6 V12 L16 14',
  signal: 'M2 22 V14 M9 22 V10 M16 22 V6 M22.5 22 V2',
  satellite: 'M5 5 L9.5 9.5 M14.5 14.5 L19 19 M9 12 A3 3 0 1 1 12 9 M15 5 L19 9 L21 7 L17 3 Z M5 17 L9 21 L7 23 L3 19 Z',
  pin: 'M12 22 S5 16.5 5 10 A7 7 0 1 1 19 10 C19 16.5 12 22 12 22 Z M12 13 A3 3 0 1 1 15 10 A3 3 0 0 1 12 13 Z',
  arrow: 'M5 12 H19 M13 6 L19 12 L13 18',
  arrowUp: 'M12 19 V5 M5 12 L12 5 L19 12',
  arrowDown: 'M12 5 V19 M5 12 L12 19 L19 12',
  arrowDownRight: 'M7 7 L17 17 M17 7 H17 V17',
  more: 'M5 12 A1 1 0 1 1 5 14 A1 1 0 0 1 5 12 Z M11 12 A1 1 0 1 1 11 14 A1 1 0 0 1 11 12 Z M17 12 A1 1 0 1 1 17 14 A1 1 0 0 1 17 12 Z',
  sun: 'M12 17 A5 5 0 1 1 12 7 A5 5 0 0 1 12 17 Z M12 1 V3 M12 21 V23 M4.22 4.22 L5.64 5.64 M18.36 18.36 L19.78 19.78 M1 12 H3 M21 12 H23 M4.22 19.78 L5.64 18.36 M18.36 5.64 L19.78 4.22',
  moon: 'M21 12.79 A9 9 0 1 1 11.21 3 A7 7 0 0 0 21 12.79 Z',
  triangleDown: 'M12 17 L5 9 H19 Z',
  triangleUp: 'M12 7 L19 15 H5 Z',
};

function Icon({ name, size = 20, stroke = 1.75, fill = 'none', className = '', style = {}, ...rest }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`vp-icon ${className}`}
      style={style}
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

window.Icon = Icon;


// ----- Map.jsx -----
// VP-Overwatch Map — styled canvas renderer.
// Self-contained (no network tiles). Renders:
//   - Layered map surfaces (water, parks, highways, arterials, locals)
//   - Aircraft markers with trail and predictive vector
//   - Ground report markers with freshness rings + pulse for confirmed
//   - User position with directional cursor + accuracy halo
//   - Heatmap overlay (toggleable)
// Pan via drag, zoom via wheel/pinch (limited range).
// All coordinates: app-space meters; transform = view = pan + scale.

const { useEffect, useRef, useState, useCallback } = React;

const PX_PER_METER_AT_1 = 0.08;  // base scale
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.5;
const REFRESH_MS = 3000;         // live position refresh cadence
const CAR_SRC = 'assets/vpo_car_clean.png';
const HELI_SRC = 'assets/vpo_helicopter_clean.png';
// Ground report kinds represented by a moving unit (vs. a fixed camera)
const CAR_KINDS = new Set(['marked', 'unmarked', 'hidden', 'stop', 'checkpoint', 'rbt']);

function angleDiff(a, b) { return ((b - a + 540) % 360) - 180; }

function useMarkerImages() {
  const ref = useRef({ car: null, heli: null });
  const [, force] = useState(0);
  useEffect(() => {
    let loaded = 0;
    const bump = () => { if (++loaded === 2) force(v => v + 1); };
    const car = new Image(); car.src = CAR_SRC; car.onload = () => { ref.current.car = car; bump(); };
    const heli = new Image(); heli.src = HELI_SRC; heli.onload = () => { ref.current.heli = heli; bump(); };
  }, []);
  return ref;
}

function VPMap({
  width, height,
  aircraft, reports, user, mapFeatures,
  selectedAircraftId, selectedReportId,
  onSelectAircraft, onSelectReport, onLongPress,
  scrubT,                     // seconds in the past, 0 = now
  layers,                     // { aircraft, reports, heatmap, trails, predictive }
  mapStyle = 'night',         // 'night' | 'toner' | 'terrain'
  theme = 'dark',
  followUser = false,
  markerStyle = 'glyph',      // 'glyph' | 'minimal'
  onCameraChange,
  focusTarget,                // {x, y} — when set, springs camera to that world coord
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [cam, setCam] = useState({ tx: 0, ty: 0, zoom: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;

  // Smooth aircraft positions interpolation — track time loop
  const animRef = useRef({ phase: 0 });

  // Pan / pinch state
  const dragRef = useRef(null);
  const pressRef = useRef(null);

  // -----------------------------------------------------------------
  // Pan, pinch, wheel zoom
  // -----------------------------------------------------------------
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    let pointers = new Map();
    let initialPinch = null;

    const handleDown = (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragRef.current = { startX: e.clientX, startY: e.clientY, camTx: camRef.current.tx, camTy: camRef.current.ty, moved: false };
        pressRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), timer: setTimeout(() => {
          if (pressRef.current && !dragRef.current?.moved) {
            // Long-press: fire callback with map coords
            const rect = el.getBoundingClientRect();
            const sx = pressRef.current.x - rect.left;
            const sy = pressRef.current.y - rect.top;
            const { tx, ty, zoom } = camRef.current;
            const scale = PX_PER_METER_AT_1 * zoom;
            const mx = (sx - width / 2 - tx) / scale;
            const my = -((sy - height / 2 - ty) / scale);
            onLongPress?.({ x: mx, y: my, sx, sy });
            // Hint haptic
            if (navigator.vibrate) navigator.vibrate(8);
          }
        }, 500) };
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        initialPinch = { dist: Math.hypot(dx, dy), zoom: camRef.current.zoom };
        if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
        pressRef.current = null;
      }
    };

    const handleMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1 && dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        if (Math.hypot(dx, dy) > 6) {
          dragRef.current.moved = true;
          if (pressRef.current?.timer) { clearTimeout(pressRef.current.timer); pressRef.current = null; }
        }
        setCam(c => ({ ...c, tx: dragRef.current.camTx + dx, ty: dragRef.current.camTy + dy }));
      } else if (pointers.size === 2 && initialPinch) {
        const pts = [...pointers.values()];
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const dist = Math.hypot(dx, dy);
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialPinch.zoom * (dist / initialPinch.dist)));
        setCam(c => ({ ...c, zoom: newZoom }));
      }
    };

    const handleUp = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) initialPinch = null;
      if (pointers.size === 0) {
        dragRef.current = null;
        if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
        pressRef.current = null;
      }
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setCam(c => ({ ...c, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * factor)) }));
    };

    el.addEventListener('pointerdown', handleDown);
    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerup', handleUp);
    el.addEventListener('pointercancel', handleUp);
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', handleDown);
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerup', handleUp);
      el.removeEventListener('pointercancel', handleUp);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [width, height, onLongPress]);

  // -----------------------------------------------------------------
  // Follow user — spring-recenter
  // -----------------------------------------------------------------
  useEffect(() => {
    if (followUser) {
      let raf;
      const startTx = camRef.current.tx;
      const startTy = camRef.current.ty;
      const startTime = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - startTime) / 600);
        const ease = 1 - Math.pow(1 - t, 3);
        setCam(c => ({ ...c, tx: startTx * (1 - ease), ty: startTy * (1 - ease) }));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
  }, [followUser]);

  // -----------------------------------------------------------------
  // Focus on a target — spring camera to a world coord, optionally bumping zoom
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!focusTarget) return;
    let raf;
    const startTx = camRef.current.tx;
    const startTy = camRef.current.ty;
    const startZoom = camRef.current.zoom;
    const targetZoom = Math.max(startZoom, 1.4);
    // We want target to land at (0,0) screen-offset from center
    // After scaling: screen_x = cx + tx + target.x * scale  -> we want screen_x == cx ->
    // tx = -target.x * scale.
    const endScale = PX_PER_METER_AT_1 * targetZoom;
    const endTx = -focusTarget.x * endScale;
    const endTy =  focusTarget.y * endScale;
    const t0 = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / 700);
      const ease = 1 - Math.pow(1 - t, 3);
      setCam({
        tx: startTx + (endTx - startTx) * ease,
        ty: startTy + (endTy - startTy) * ease,
        zoom: startZoom + (targetZoom - startZoom) * ease,
      });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focusTarget]);

  useEffect(() => { onCameraChange?.(cam); }, [cam, onCameraChange]);

  // -----------------------------------------------------------------
  // Live position refresh — every REFRESH_MS, advance aircraft along
  // heading/speed and drift mobile ground units. The render loop below
  // eases smoothly between the previous and next fix (never teleports).
  // -----------------------------------------------------------------
  const markerImgsRef = useMarkerImages();
  const acLiveStateRef = useRef({});
  const acAnimRef = useRef({});
  const grLiveStateRef = useRef({});
  const grAnimRef = useRef({});

  useEffect(() => {
    const tickAircraft = () => {
      aircraft.forEach(a => {
        let s = acLiveStateRef.current[a.id];
        if (!s) {
          const p0 = sampleTrack(a.track, 0);
          if (!p0) return;
          s = { x: p0.x, y: p0.y, hdg: p0.hdg, spd: p0.spd, alt: p0.alt, vs: p0.vs };
        }
        const hdgRad = (s.hdg - 90) * Math.PI / 180;
        const dist = s.spd * 0.514 * (REFRESH_MS / 1000);
        const nx = s.x + Math.cos(hdgRad) * dist;
        const ny = s.y - Math.sin(hdgRad) * dist;
        const nhdg = (s.hdg + (Math.random() * 8 - 4) + 360) % 360;
        acAnimRef.current[a.id] = {
          from: { x: s.x, y: s.y, hdg: s.hdg },
          to: { x: nx, y: ny, hdg: nhdg },
          t0: Date.now(), dur: REFRESH_MS,
        };
        acLiveStateRef.current[a.id] = { ...s, x: nx, y: ny, hdg: nhdg };
      });
    };
    const tickGround = () => {
      reports.forEach(r => {
        if (!CAR_KINDS.has(r.kind)) return;
        const s = grLiveStateRef.current[r.id] || { x: r.x, y: r.y };
        const MAX_DRIFT = 60;
        const dx = s.x - r.x, dy = s.y - r.y;
        const distFromOrigin = Math.hypot(dx, dy);
        let nx = s.x + (Math.random() * 2 - 1) * 35;
        let ny = s.y + (Math.random() * 2 - 1) * 35;
        if (distFromOrigin > MAX_DRIFT) {
          nx = r.x + (dx / distFromOrigin) * (MAX_DRIFT * 0.5);
          ny = r.y + (dy / distFromOrigin) * (MAX_DRIFT * 0.5);
        }
        grAnimRef.current[r.id] = {
          from: { x: s.x, y: s.y },
          to: { x: nx, y: ny },
          t0: Date.now(), dur: REFRESH_MS,
        };
        grLiveStateRef.current[r.id] = { x: nx, y: ny };
      });
    };
    tickAircraft(); tickGround();
    const id = setInterval(() => { tickAircraft(); tickGround(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [aircraft, reports]);

  function liveAircraftPos(a, scrubT) {
    const anim = acAnimRef.current[a.id];
    if (scrubT < 0.5 && anim) {
      const u = Math.min(1, (Date.now() - anim.t0) / anim.dur);
      const s = acLiveStateRef.current[a.id] || {};
      return {
        x: anim.from.x + (anim.to.x - anim.from.x) * u,
        y: anim.from.y + (anim.to.y - anim.from.y) * u,
        hdg: (anim.from.hdg + angleDiff(anim.from.hdg, anim.to.hdg) * u + 360) % 360,
        alt: s.alt ?? 1000, spd: s.spd ?? 80, vs: s.vs ?? 0,
      };
    }
    return sampleTrack(a.track, scrubT);
  }

  function liveReportPos(r, scrubT) {
    const anim = grAnimRef.current[r.id];
    if (scrubT < 0.5 && anim) {
      const u = Math.min(1, (Date.now() - anim.t0) / anim.dur);
      return {
        x: anim.from.x + (anim.to.x - anim.from.x) * u,
        y: anim.from.y + (anim.to.y - anim.from.y) * u,
      };
    }
    return { x: r.x, y: r.y };
  }

  // -----------------------------------------------------------------
  // Resolve theme tokens (read from CSS vars)
  // -----------------------------------------------------------------
  const tokens = useMapTokens(theme, mapStyle);

  // -----------------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------------
  useEffect(() => {
    let raf;
    const render = () => {
     try {
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(render); return; }
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { tx, ty, zoom } = camRef.current;
      const scale = PX_PER_METER_AT_1 * zoom;
      const cx = width / 2 + tx;
      const cy = height / 2 + ty;
      const project = (p) => ({ x: cx + p.x * scale, y: cy - p.y * scale });

      // ---- BASE ----
      ctx.fillStyle = tokens.bg;
      ctx.fillRect(0, 0, width, height);

      // Subtle hypsometric tint (radial)
      if (mapStyle === 'terrain' || mapStyle === 'night') {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.8);
        grad.addColorStop(0, mapStyle === 'terrain' ? 'rgba(40,55,40,0.20)' : 'rgba(20,30,50,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // ---- LAND (subtle layered surfaces) ----
      if (mapStyle !== 'toner') {
        ctx.fillStyle = tokens.land;
        ctx.fillRect(0, 0, width, height);
        // grid texture
        ctx.strokeStyle = tokens.grid;
        ctx.lineWidth = 0.5;
        const gridStep = 1000 * scale;
        const offsetX = ((cx % gridStep) + gridStep) % gridStep;
        const offsetY = ((cy % gridStep) + gridStep) % gridStep;
        for (let x = offsetX; x < width; x += gridStep) {
          ctx.beginPath();
          ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        for (let y = offsetY; y < height; y += gridStep) {
          ctx.beginPath();
          ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
      }

      // ---- WATER ----
      ctx.fillStyle = tokens.water;
      ctx.strokeStyle = tokens.water;
      mapFeatures.water.forEach(w => {
        if (w.kind === 'river') {
          ctx.lineWidth = w.width * scale;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          w.points.forEach((p, i) => {
            const q = project(p);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
          ctx.stroke();
        }
      });

      // ---- PARKS ----
      ctx.fillStyle = tokens.park;
      mapFeatures.parks.forEach(poly => {
        ctx.beginPath();
        poly.forEach((p, i) => {
          const q = project(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.closePath();
        ctx.fill();
      });

      // ---- ROADS ----
      // Local streets (thinnest, faded)
      ctx.strokeStyle = tokens.roadLocal;
      ctx.lineWidth = Math.max(0.5, 1.2 * Math.sqrt(zoom));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      mapFeatures.roads.locals.forEach(line => {
        ctx.beginPath();
        line.forEach((p, i) => {
          const q = project(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      });

      // Arterials (medium, brighter)
      ctx.strokeStyle = tokens.roadArt;
      ctx.lineWidth = Math.max(1.2, 2.2 * Math.sqrt(zoom));
      mapFeatures.roads.arterials.forEach(line => {
        ctx.beginPath();
        line.forEach((p, i) => {
          const q = project(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      });

      // Highways (thickest, with casing)
      mapFeatures.roads.highways.forEach(line => {
        // Casing
        ctx.strokeStyle = tokens.roadHwyCase;
        ctx.lineWidth = Math.max(3.5, 6 * Math.sqrt(zoom));
        ctx.beginPath();
        line.forEach((p, i) => {
          const q = project(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
        // Fill
        ctx.strokeStyle = tokens.roadHwy;
        ctx.lineWidth = Math.max(2, 4 * Math.sqrt(zoom));
        ctx.beginPath();
        line.forEach((p, i) => {
          const q = project(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      });

      // ---- HEATMAP OVERLAY ----
      if (layers.heatmap) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        reports.forEach(r => {
          const q = project(liveReportPos(r, scrubT));
          const radius = 80 * Math.sqrt(zoom);
          const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, radius);
          g.addColorStop(0, 'rgba(77,124,255,0.35)');
          g.addColorStop(0.5, 'rgba(77,124,255,0.12)');
          g.addColorStop(1, 'rgba(77,124,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(q.x, q.y, radius, 0, Math.PI * 2); ctx.fill();
        });
        // Add density around aircraft positions
        aircraft.forEach(a => {
          const pos = liveAircraftPos(a, scrubT);
          if (!pos) return;
          const q = project(pos);
          const radius = 100 * Math.sqrt(zoom);
          const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, radius);
          g.addColorStop(0, 'rgba(255,176,32,0.45)');
          g.addColorStop(0.5, 'rgba(255,176,32,0.15)');
          g.addColorStop(1, 'rgba(255,176,32,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(q.x, q.y, radius, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
      }

      // ---- AIRCRAFT TRAILS ----
      if (layers.aircraft && layers.trails) {
        aircraft.forEach(a => {
          const isSelected = a.id === selectedAircraftId;
          const trailMinutes = isSelected ? 15 : 4;
          const trail = sampleTrailUntil(a.track, scrubT, trailMinutes * 60);
          if (trail.length < 2) return;
          // Render with fading opacity
          for (let i = 1; i < trail.length; i++) {
            const p1 = project(trail[i - 1]);
            const p2 = project(trail[i]);
            const ageNorm = i / trail.length; // 0=newest, 1=oldest
            const op = (1 - ageNorm) * (isSelected ? 0.85 : 0.45);
            ctx.strokeStyle = tokens.amber;
            ctx.globalAlpha = op;
            ctx.lineWidth = isSelected ? 2.4 : 1.6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        });
      }

      // ---- PREDICTIVE VECTOR (selected aircraft) ----
      if (layers.aircraft && layers.predictive && selectedAircraftId) {
        const a = aircraft.find(x => x.id === selectedAircraftId);
        if (a) {
          const pos = liveAircraftPos(a, scrubT);
          const next = sampleTrack(a.track, scrubT - 30); // 30s ahead
          if (pos && next) {
            // Forward vector: from current pos, project forward via heading & speed
            const hdgRad = (pos.hdg - 90) * Math.PI / 180;
            // 60s ahead at current speed; 1kt ≈ 0.514 m/s
            const fwd60 = pos.spd * 0.514 * 60;
            const fwd90 = pos.spd * 0.514 * 90;
            const c = project(pos);
            const f60 = project({ x: pos.x + Math.cos(hdgRad) * fwd60, y: pos.y - Math.sin(hdgRad) * fwd60 });
            const f90 = project({ x: pos.x + Math.cos(hdgRad) * fwd90, y: pos.y - Math.sin(hdgRad) * fwd90 });

            // Cone gradient
            const grad = ctx.createLinearGradient(c.x, c.y, f90.x, f90.y);
            grad.addColorStop(0, 'rgba(255,176,32,0.55)');
            grad.addColorStop(0.5, 'rgba(255,176,32,0.18)');
            grad.addColorStop(1, 'rgba(255,176,32,0)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(f90.x, f90.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Tick at 60s
            ctx.strokeStyle = 'rgba(255,176,32,0.7)';
            ctx.lineWidth = 1.5;
            // perpendicular tick
            const tickLen = 8;
            const perpRad = hdgRad + Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(f60.x + Math.cos(perpRad) * tickLen, f60.y - Math.sin(perpRad) * tickLen);
            ctx.lineTo(f60.x - Math.cos(perpRad) * tickLen, f60.y + Math.sin(perpRad) * tickLen);
            ctx.stroke();
          }
        }
      }

      // ---- GROUND REPORTS ----
      if (layers.reports) {
        reports.forEach(r => {
          // If scrubbing back, fade reports that didn't exist yet
          const reportAgeAtScrub = r.reportedAgo - scrubT;
          if (reportAgeAtScrub < 0) return; // didn't exist yet
          const ageOpacity = Math.min(1, Math.max(0.35, 1 - (reportAgeAtScrub / 1800)));
          const q = project(liveReportPos(r, scrubT));
          const isSelected = r.id === selectedReportId;
          const radius = isSelected ? 16 : 13;

          // Freshness ring — outer
          const freshness = Math.max(0, 1 - (reportAgeAtScrub - r.lastConfirmedAgo + 60) / 600);
          if (freshness > 0) {
            ctx.strokeStyle = `rgba(255,71,87,${0.5 * freshness * ageOpacity})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(q.x, q.y, radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * freshness);
            ctx.stroke();
          }

          // Pulse on confirmed (>5 confirmations, recent)
          const confirmed = r.confirmations >= 5 && r.lastConfirmedAgo < 120;
          if (confirmed) {
            const pulse = (Math.sin(animRef.current.phase * 2) + 1) / 2;
            ctx.strokeStyle = `rgba(255,71,87,${0.4 * (1 - pulse) * ageOpacity})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(q.x, q.y, radius + 8 + pulse * 8, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Marker — car image for mobile/ground units, disc+glyph for fixed cameras
          ctx.globalAlpha = ageOpacity;
          const carImg = markerImgsRef.current.car;
          if (CAR_KINDS.has(r.kind) && carImg) {
            const cw = (isSelected ? 34 : 27);
            const ch = cw * (carImg.height / carImg.width);
            const isHidden = r.kind === 'hidden';
            const baseAlpha = isHidden ? ageOpacity * 0.6 : ageOpacity;
            ctx.save();
            ctx.globalAlpha = baseAlpha;
            ctx.shadowColor = isHidden ? tokens.stale : tokens.redHi;
            ctx.shadowBlur = isSelected ? 14 : 7;
            ctx.drawImage(carImg, q.x - cw / 2, q.y - ch / 2, cw, ch);
            ctx.drawImage(carImg, q.x - cw / 2, q.y - ch / 2, cw, ch); // deepen glow
            ctx.restore();
            ctx.globalAlpha = ageOpacity;
            if (r.kind === 'unmarked' || r.kind === 'hidden') {
              ctx.strokeStyle = tokens.red;
              ctx.lineWidth = 1.2;
              ctx.setLineDash([3, 2]);
              ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(cw, ch) / 2 + 6, 0, Math.PI * 2); ctx.stroke();
              ctx.setLineDash([]);
            }
            if (isSelected) {
              ctx.strokeStyle = tokens.redHi;
              ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(cw, ch) / 2 + 4, 0, Math.PI * 2); ctx.stroke();
            }
          } else {
            ctx.fillStyle = tokens.ink0;
            ctx.beginPath(); ctx.arc(q.x, q.y, radius, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = tokens.red;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath(); ctx.arc(q.x, q.y, radius, 0, Math.PI * 2); ctx.stroke();
            drawReportGlyph(ctx, r.kind, q.x, q.y, radius, tokens.red);
          }
          ctx.globalAlpha = 1;

          // Selection ring
          if (isSelected) {
            ctx.strokeStyle = tokens.blue;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(q.x, q.y, radius + 4, 0, Math.PI * 2); ctx.stroke();
          }
        });
      }

      // ---- AIRCRAFT MARKERS ----
      if (layers.aircraft) {
        aircraft.forEach(a => {
          const pos = liveAircraftPos(a, scrubT);
          if (!pos) return;
          const q = project(pos);
          const isSelected = a.id === selectedAircraftId;
          // Size scales subtly with altitude
          const sizeFactor = 1 + Math.min(0.4, pos.alt / 8000);
          const size = (isSelected ? 22 : 18) * sizeFactor;

          const heliImg = markerImgsRef.current.heli;
          // Bright amber glow behind the helicopter so it reads instantly against the dark map
          ctx.save();
          const haloR = size * 1.9;
          const halo = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, haloR);
          halo.addColorStop(0, isSelected ? 'rgba(255,196,77,0.65)' : 'rgba(255,176,32,0.45)');
          halo.addColorStop(1, 'rgba(255,176,32,0)');
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(q.x, q.y, haloR, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate((pos.hdg) * Math.PI / 180);
          if (heliImg) {
            const hh = size * 2.3;
            const hw = hh * (heliImg.width / heliImg.height);
            ctx.save();
            ctx.shadowColor = tokens.amberHi;
            ctx.shadowBlur = isSelected ? 18 : 10;
            ctx.drawImage(heliImg, -hw / 2, -hh / 2, hw, hh);
            ctx.drawImage(heliImg, -hw / 2, -hh / 2, hw, hh); // second pass deepens the glow
            ctx.restore();
            if (isSelected) {
              ctx.strokeStyle = tokens.amberHi;
              ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.arc(0, 0, hw * 0.62, 0, Math.PI * 2); ctx.stroke();
            }
          } else if (a.role === 'rotary') {
            drawRotary(ctx, size, tokens.amber, tokens.ink0, isSelected);
          } else {
            drawFixedWing(ctx, size, tokens.amber, tokens.ink0, isSelected);
          }
          ctx.restore();

          // Selection ring
          if (isSelected) {
            ctx.strokeStyle = tokens.amber;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.arc(q.x, q.y, size + 8, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }

          // Callsign label (only if zoomed or selected)
          if (isSelected || zoom > 1.3) {
            ctx.fillStyle = tokens.amber;
            ctx.font = '600 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            // Background pill
            const text = a.callsign;
            const metrics = ctx.measureText(text);
            const padX = 5, padY = 3;
            const labelY = q.y + size + 4;
            ctx.fillStyle = 'rgba(10,11,13,0.85)';
            ctx.beginPath();
            const w = metrics.width + padX * 2;
            const h = 14;
            const lx = q.x - w / 2;
            roundRect(ctx, lx, labelY, w, h, 3);
            ctx.fill();
            ctx.fillStyle = tokens.amber;
            ctx.fillText(text, q.x, labelY + 2);
          }
        });
      }

      // ---- USER POSITION ----
      const u = project(user);
      // Accuracy halo
      const haloR = Math.max(20, user.accuracy * scale * 8);
      ctx.fillStyle = 'rgba(77,124,255,0.10)';
      ctx.beginPath(); ctx.arc(u.x, u.y, haloR, 0, Math.PI * 2); ctx.fill();
      // Direction cone
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(user.hdg * Math.PI / 180);
      const coneGrad = ctx.createLinearGradient(0, 0, 0, -28);
      coneGrad.addColorStop(0, 'rgba(77,124,255,0.6)');
      coneGrad.addColorStop(1, 'rgba(77,124,255,0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-10, -28);
      ctx.lineTo(10, -28);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // User dot
      ctx.fillStyle = tokens.blue;
      ctx.beginPath(); ctx.arc(u.x, u.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(u.x, u.y, 7, 0, Math.PI * 2); ctx.stroke();

      // ---- COORDS HUD (corner) ----
      ctx.fillStyle = tokens.fg3;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(`SCALE 1:${Math.round(50000 / zoom)}`, width - 10, 10);

      animRef.current.phase += 0.05;
      raf = requestAnimationFrame(render);
     } catch (err) {
       console.error('VPMap render error', err);
     }
    };
    render(); // paint the first frame synchronously — don't wait on a possibly-throttled rAF
    return () => cancelAnimationFrame(raf);
  }, [width, height, aircraft, reports, user, mapFeatures, selectedAircraftId, selectedReportId, scrubT, layers, mapStyle, theme, tokens]);

  // -----------------------------------------------------------------
  // Click → hit test (uses current cam)
  // -----------------------------------------------------------------
  const handleClick = (e) => {
    if (dragRef.current?.moved) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { tx, ty, zoom } = camRef.current;
    const scale = PX_PER_METER_AT_1 * zoom;
    const cx = width / 2 + tx;
    const cy = height / 2 + ty;
    const project = (p) => ({ x: cx + p.x * scale, y: cy - p.y * scale });

    // Check aircraft first
    for (const a of aircraft) {
      const pos = liveAircraftPos(a, scrubT);
      if (!pos) continue;
      const q = project(pos);
      if (Math.hypot(sx - q.x, sy - q.y) < 26) { onSelectAircraft?.(a.id); return; }
    }
    for (const r of reports) {
      if (r.reportedAgo - scrubT < 0) continue;
      const q = project(liveReportPos(r, scrubT));
      if (Math.hypot(sx - q.x, sy - q.y) < 22) { onSelectReport?.(r.id); return; }
    }
    // Click on empty space — deselect
    onSelectAircraft?.(null);
    onSelectReport?.(null);
  };

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: 'var(--map-bg)' }}>
      <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
      <div
        ref={overlayRef}
        onClick={handleClick}
        style={{
          position: 'absolute', inset: 0,
          touchAction: 'none',
          cursor: dragRef.current?.moved ? 'grabbing' : 'grab',
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function useMapTokens(theme, mapStyle) {
  // Read CSS vars via getComputedStyle at runtime; re-eval on theme change
  const [tokens, setTokens] = React.useState(() => readTokens(theme, mapStyle));
  React.useEffect(() => { setTokens(readTokens(theme, mapStyle)); }, [theme, mapStyle]);
  return tokens;
}

function readTokens(theme, mapStyle) {
  const cs = getComputedStyle(document.documentElement);
  const get = (k) => cs.getPropertyValue(k).trim() || '#000';

  let bg = get('--map-bg');
  let water = get('--map-water');
  let land = get('--map-land');
  let park = get('--map-park');
  let roadHwy = '#3A4049';
  let roadHwyCase = '#1A1D22';
  let roadArt = get('--map-road-a');
  let roadLocal = get('--map-road-b');
  let grid = 'rgba(255,255,255,0.025)';
  let label = get('--map-label');

  if (mapStyle === 'toner') {
    // High contrast B&W
    bg = theme === 'dark' ? '#0A0B0D' : '#FFFFFF';
    land = theme === 'dark' ? '#0A0B0D' : '#FFFFFF';
    water = theme === 'dark' ? '#1A1D22' : '#E0E4E8';
    park = theme === 'dark' ? '#15171B' : '#F0F2F4';
    roadHwy = theme === 'dark' ? '#5A6270' : '#0A0B0D';
    roadHwyCase = theme === 'dark' ? '#0A0B0D' : '#5A6270';
    roadArt = theme === 'dark' ? '#3A4049' : '#3A4049';
    roadLocal = theme === 'dark' ? '#2A2F37' : '#A6ADBB';
    grid = 'rgba(255,255,255,0)';
  } else if (mapStyle === 'terrain') {
    park = theme === 'dark' ? '#1A2418' : '#D9E4D6';
  }

  return {
    bg, water, land, park, roadHwy, roadHwyCase, roadArt, roadLocal, grid, label,
    amber: get('--amber'),
    amberHi: get('--amber-hi'),
    blue:  get('--blue'),
    red:   get('--red'),
    redHi: get('--red-hi'),
    green: get('--green'),
    fg1:   get('--fg-1'),
    fg2:   get('--fg-2'),
    fg3:   get('--fg-3'),
    ink0:  get('--ink-0'),
    ink1:  get('--ink-1'),
    stale: get('--stale'),
  };
}

function sampleTrack(track, secondsAgo) {
  if (!track || track.length === 0) return null;
  // track[0] is now (t=0), going backwards
  // Find points bracketing -secondsAgo
  const target = -secondsAgo;
  if (target >= track[0].t) return track[0];
  if (target <= track[track.length - 1].t) return null;
  for (let i = 0; i < track.length - 1; i++) {
    if (track[i].t >= target && track[i + 1].t <= target) {
      const a = track[i], b = track[i + 1];
      const u = (target - a.t) / (b.t - a.t);
      // Linear interp position; nearest for heading to avoid wrap mess
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        alt: a.alt + (b.alt - a.alt) * u,
        hdg: u < 0.5 ? a.hdg : b.hdg,
        spd: a.spd + (b.spd - a.spd) * u,
        vs:  a.vs + (b.vs - a.vs) * u,
      };
    }
  }
  return track[track.length - 1];
}

function sampleTrailUntil(track, scrubT, lookbackSec) {
  if (!track) return [];
  const out = [];
  const startT = -scrubT;
  const endT = startT - lookbackSec;
  for (const p of track) {
    if (p.t <= startT && p.t >= endT) out.push(p);
  }
  return out;
}

function drawRotary(ctx, size, color, dark, selected) {
  const half = size / 2;
  // Rotor disc — faint
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.1, half * 1.05, half * 0.22, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Fuselage chevron
  ctx.fillStyle = color;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, -half);
  ctx.lineTo(half * 0.5, half * 0.6);
  ctx.lineTo(0, half * 0.3);
  ctx.lineTo(-half * 0.5, half * 0.6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Tail boom
  ctx.fillRect(-1, half * 0.2, 2, half * 0.6);
  // Tail rotor
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-half * 0.3, half * 0.8);
  ctx.lineTo(half * 0.3, half * 0.8);
  ctx.stroke();
}

function drawFixedWing(ctx, size, color, dark, selected) {
  const half = size / 2;
  ctx.fillStyle = color;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.4;
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(0, -half);
  ctx.lineTo(half * 0.18, half);
  ctx.lineTo(-half * 0.18, half);
  ctx.closePath();
  ctx.fill();
  // Wings
  ctx.beginPath();
  ctx.moveTo(-half * 0.9, half * 0.05);
  ctx.lineTo(half * 0.9, half * 0.05);
  ctx.lineTo(half * 0.9, half * 0.32);
  ctx.lineTo(-half * 0.9, half * 0.32);
  ctx.closePath();
  ctx.fill();
  // Tail
  ctx.beginPath();
  ctx.moveTo(-half * 0.4, half * 0.65);
  ctx.lineTo(half * 0.4, half * 0.65);
  ctx.lineTo(half * 0.4, half * 0.85);
  ctx.lineTo(-half * 0.4, half * 0.85);
  ctx.closePath();
  ctx.fill();
}

function drawReportGlyph(ctx, kind, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  const s = r * 0.55;
  switch (kind) {
    case 'marked':
      // small sedan rect
      ctx.fillRect(-s * 0.7, -s * 0.2, s * 1.4, s * 0.45);
      ctx.beginPath(); ctx.arc(-s * 0.5, s * 0.3, s * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.3, s * 0.15, 0, Math.PI * 2); ctx.fill();
      break;
    case 'unmarked':
      ctx.fillRect(-s * 0.7, -s * 0.2, s * 1.4, s * 0.45);
      break;
    case 'hidden':
      // eye
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.8, s * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2); ctx.fill();
      break;
    case 'stop':
      // triangle warning
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.7);
      ctx.lineTo(s * 0.7, s * 0.5);
      ctx.lineTo(-s * 0.7, s * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(-1, -s * 0.3, 2, s * 0.5);
      ctx.beginPath(); ctx.arc(0, s * 0.35, 1.2, 0, Math.PI * 2); ctx.fill();
      break;
    case 'checkpoint':
      // gate bar
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-s * 0.7, s * 0.3); ctx.lineTo(s * 0.7, -s * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.arc(-s * 0.7, s * 0.3, 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'rbt':
      // breath-test mouthpiece tube
      ctx.fillRect(-s * 0.7, -s * 0.25, s * 1.4, s * 0.45);
      ctx.fillRect(s * 0.55, -s * 0.12, s * 0.25, s * 0.20);
      // small "R" indicator - just a hash
      ctx.fillStyle = '#0A0B0D';
      ctx.fillRect(-s * 0.35, -s * 0.12, s * 0.12, s * 0.25);
      break;
    case 'camera':
      // camera body
      ctx.fillRect(-s * 0.7, -s * 0.25, s * 1.2, s * 0.7);
      // lens
      ctx.fillStyle = '#0A0B0D';
      ctx.beginPath(); ctx.arc(-s * 0.15, s * 0.1, s * 0.25, 0, Math.PI * 2); ctx.fill();
      // flash
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.2, -s * 0.45, s * 0.3, s * 0.18);
      break;
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

window.VPMap = VPMap;
window.sampleTrack = sampleTrack;


// ----- StatusStrip.jsx -----
// Top status strip — blurs over map.
// Shows: relay health · active aircraft · ground reports in radius · last update.

function StatusStrip({ aircraftCount, silentCount, reportsCount, scrubT, relay, theme, onThemeToggle }) {
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
        {silentCount > 0 && <Stat n={silentCount} label="silent" tone="blue" />}
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


// ----- Scrubber.jsx -----
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


// ----- BottomSheet.jsx -----
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
          transition: ${dragRef.current ? 'none' : 'height var(--dur-panel) var(--ease-spring)'};
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


// ----- AircraftDetail.jsx -----
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


// ----- ReportDetail.jsx -----
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


// ----- FilterPanel.jsx -----
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


// ----- Fab.jsx -----
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


// ----- Onboarding.jsx -----
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


// ----- App.jsx -----
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
    theme:          loadedTweaks.theme          || props.theme          || 'dark',
    mapStyle:       loadedTweaks.mapStyle       || props.mapStyle       || 'night',
    density:        loadedTweaks.density        || props.density        || 'comfortable',
    showPredictive: loadedTweaks.showPredictive ?? props.showPredictive ?? true,
    showTrails:     loadedTweaks.showTrails     ?? props.showTrails     ?? true,
    showHeatmap:    loadedTweaks.showHeatmap    ?? props.showHeatmap    ?? false,
  };

  // setTweak: persists key/value pairs to localStorage and syncs theme state.
  const setTweak = (update) => {
    try {
      const prev = JSON.parse(localStorage.getItem('vp-tweaks') || '{}');
      localStorage.setItem('vp-tweaks', JSON.stringify({ ...prev, ...update }));
    } catch {}
    if (update.theme) setTheme(update.theme);
  };

  // Onboarding disabled — the boot sequence delivers straight to the map.
  const [showOnboarding, setShowOnboarding] = useStateA(false);

  const [theme, setTheme] = useStateA(t.theme || 'dark');
  useEffectA(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

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

