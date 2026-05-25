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
        t: -t,
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
          x: cx + Math.cos(a) * (w / 2) * (0.8 + Math.random() * 0.4),
          y: cy + Math.sin(a) * (h / 2) * (0.8 + Math.random() * 0.4),
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
