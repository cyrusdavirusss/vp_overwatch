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
  // Focus camera on selected aircraft / report
  // Uses live animated position for aircraft so the camera lands on where
  // the marker is actually drawn, not the frozen track snapshot.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!selectedAircraftId && !selectedReportId) return;
    let wx, wy;
    if (selectedAircraftId) {
      const a = aircraft.find(x => x.id === selectedAircraftId);
      if (!a) return;
      const anim = acAnimRef.current[a.id];
      if (anim) {
        const u = Math.min(1, (Date.now() - anim.t0) / anim.dur);
        wx = anim.from.x + (anim.to.x - anim.from.x) * u;
        wy = anim.from.y + (anim.to.y - anim.from.y) * u;
      } else {
        const pos = sampleTrack(a.track, 0);
        if (!pos) return;
        wx = pos.x; wy = pos.y;
      }
    } else {
      const r = reports.find(x => x.id === selectedReportId);
      if (!r) return;
      wx = r.x; wy = r.y;
    }
    let raf;
    const startTx = camRef.current.tx;
    const startTy = camRef.current.ty;
    const startZoom = camRef.current.zoom;
    const targetZoom = Math.max(startZoom, 2.2);
    const endScale = PX_PER_METER_AT_1 * targetZoom;
    const endTx = -wx * endScale;
    const endTy =  wy * endScale;
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
  }, [selectedAircraftId, selectedReportId]);

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
        // Clamp displacement within 60m of the report origin so the unit never
        // drifts far from where it was actually spotted.
        const MAX_DRIFT = 60;
        const dx = s.x - r.x, dy = s.y - r.y;
        const distFromOrigin = Math.hypot(dx, dy);
        let nx = s.x + (Math.random() * 2 - 1) * 35;
        let ny = s.y + (Math.random() * 2 - 1) * 35;
        if (distFromOrigin > MAX_DRIFT) {
          // Pull back toward origin
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
