#!/usr/bin/env node
/**
 * VP-Overwatch — Waze POLICE relay via WazeAPI.com (managed API).
 *
 * WazeAPI handles Cloudflare/bot-detection server-side, so this is a plain,
 * reliable HTTP client — no browser, no scraping, no babysitting. Pay-as-you-go
 * is billed per QUERY (per tile), credits never expire, so cost is predictable.
 *
 * Env (.env): WAZEAPI_KEY, API_URL (the app), RELAY_SECRET (== WAZE_RELAY_SECRET),
 *             POLL_SECONDS (default 1800 = 30 min, cost-safe), optional WAZEAPI_TILES.
 *   Run:  node relay-wazeapi.mjs        (loop)   |   --once
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) for (const raw of fs.readFileSync(envFile,'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const i = l.indexOf('='); if (i<0) continue;
  const k = l.slice(0,i).trim(); let v = l.slice(i+1).trim();
  if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  if (!(k in process.env)) process.env[k]=v;
}
const ONCE = process.argv.includes('--once');
const API_URL = (process.env.API_URL||'').replace(/\/+$/,'');
const RELAY_SECRET = process.env.RELAY_SECRET || '';
const WAZEAPI_KEY = process.env.WAZEAPI_KEY || '';
const WAZEAPI_BASE = (process.env.WAZEAPI_BASE || 'https://api.wazeapi.com/v1').replace(/\/+$/,'');
const WAZEAPI_COUNTRY = process.env.WAZEAPI_COUNTRY || 'aus';
const POLL_SECONDS = Math.max(60, Number(process.env.POLL_SECONDS)||1800);
if (!API_URL)     { console.error('Missing API_URL (e.g. http://127.0.0.1:3100)'); process.exit(1); }
if (!RELAY_SECRET){ console.error('Missing RELAY_SECRET (must match WAZE_RELAY_SECRET on the app)'); process.exit(1); }
if (!WAZEAPI_KEY) { console.error('Missing WAZEAPI_KEY — get one free at https://wazeapi.com'); process.exit(1); }

/* Victoria tiles as [name, bottom-left "lat,lng", top-right "lat,lng"].
   Per-query billing → fewer tiles = cheaper. Override with WAZEAPI_TILES
   (JSON: [["name","blat,blng","tlat,tlng"],...]). */
const DEFAULT_TILES = [
  // Inner Melbourne + south-east corridor. Tiles kept small so none hit
  // WazeAPI's 200-alert/query cap (which would silently truncate police).
  ['Inner City', '-37.85,144.88', '-37.75,145.05'],
  ['Inner SE',   '-37.95,144.98', '-37.82,145.15'],
  ['SE Mid',     '-38.00,145.10', '-37.87,145.30'],
  ['SE Outer',   '-38.15,145.15', '-37.98,145.45'],
];
let TILES = DEFAULT_TILES;
try { if (process.env.WAZEAPI_TILES) TILES = JSON.parse(process.env.WAZEAPI_TILES); } catch { console.warn('[wazeapi] bad WAZEAPI_TILES JSON, using defaults'); }

const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const isPolice = (t) => String(t||'').toUpperCase().startsWith('POLICE');

async function fetchTile([name, bl, tr], attempt=1) {
  const url = `${WAZEAPI_BASE}/alerts?bottom-left=${encodeURIComponent(bl)}&top-right=${encodeURIComponent(tr)}`;
  let r;
  try { r = await fetch(url, { headers: { 'X-API-Key': WAZEAPI_KEY, 'X-Country': WAZEAPI_COUNTRY, 'Accept':'application/json' }, signal: AbortSignal.timeout(30000) }); }
  catch (e) { if (attempt < 3) { await sleep(1500*attempt); return fetchTile([name,bl,tr], attempt+1); } throw new Error(`${name}: network ${e.message}`); }
  if (r.status === 429 || r.status >= 500) { // transient — back off + retry
    if (attempt < 3) { await sleep(2000*attempt); return fetchTile([name,bl,tr], attempt+1); }
    throw new Error(`${name}: HTTP ${r.status} (rate/quota or server) after retries`);
  }
  if (r.status === 401 || r.status === 403) throw new Error(`${name}: HTTP ${r.status} — check WAZEAPI_KEY`);
  if (r.status === 402) throw new Error(`${name}: HTTP 402 — WazeAPI credits/quota exhausted (top up at wazeapi.com)`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const data = await r.json();
  // WazeAPI returns a bare array (Waze-native fields: locationX/Y, subType, id,
  // timestamp). Fall back to {alerts:[...]} + location.lat/lng if the shape changes.
  const alerts = Array.isArray(data) ? data : (Array.isArray(data?.alerts) ? data.alerts : []);
  return alerts.filter(a => isPolice(a.type)).map(a => {
    const lat = a.locationY ?? a.location?.lat ?? a.latitude;
    const lng = a.locationX ?? a.location?.lng ?? a.longitude;
    return {
      uuid: a.id || `wz-${a.type}-${Number(lat).toFixed(5)}-${Number(lng).toFixed(5)}-${a.street||''}`,
      type: a.type, subtype: a.subType ?? a.subtype ?? null,
      location: { x: lng, y: lat },       // store reads location.x(lng)/.y(lat)
      latitude: lat, longitude: lng,       // fallback the store also accepts
      pubMillis: a.timestamp ?? (a.reported_at ? Date.parse(a.reported_at) : Date.now()),
      reliability: a.reliability, confidence: a.confidence, nThumbsUp: a.nThumbsUp,
      city: a.city || '', street: a.street || '',
    };
  }).filter(a => Number.isFinite(a.location.x) && Number.isFinite(a.location.y)); // drop bad coords → no NaN map crash
}

async function pushAlerts(alerts) {
  const r = await fetch(`${API_URL}/api/waze/ingest`, {
    method:'POST', headers:{ 'Content-Type':'application/json','x-relay-secret':RELAY_SECRET },
    body: JSON.stringify({ alerts }), signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`ingest HTTP ${r.status} — ${(await r.text().catch(()=>'')).slice(0,120)}`);
  return r.json();
}

async function tick() {
  const t0 = Date.now(); const merged = new Map(); let ok=0, fail=0;
  for (const tile of TILES) {
    try { for (const a of await fetchTile(tile)) merged.set(a.uuid, a); ok++; }
    catch (e) { fail++; console.error(`[tile] ${e.message}`); }
  }
  if (fail === TILES.length) { console.error(`[${new Date().toISOString()}] all ${TILES.length} tiles failed`); if (ONCE) process.exitCode=1; return; }
  const police = [...merged.values()];
  if (!police.length) { console.log(`[${new Date().toISOString()}] no police alerts (${ok}/${TILES.length} tiles ok)`); return; }
  try {
    const res = await pushAlerts(police);
    console.log(`[${new Date().toISOString()}] ingested ${res.ingested ?? '?'}/${police.length} police (${ok}/${TILES.length} tiles, ${Date.now()-t0}ms) [WazeAPI]`);
  } catch (e) { console.error(`[push] ${e.message}`); if (ONCE) process.exitCode=1; }
}

console.log(`WazeAPI POLICE relay → ${API_URL} | country=${WAZEAPI_COUNTRY} | ${TILES.length} VIC tiles${ONCE?' (--once)':`, every ${POLL_SECONDS}s`}`);
await tick();
if (!ONCE) setInterval(tick, POLL_SECONDS*1000);
