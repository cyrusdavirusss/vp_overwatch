#!/usr/bin/env node
/**
 * VP-Overwatch — Waze POLICE relay via WazeAPI.com (managed API).
 *
 * WazeAPI handles Cloudflare/bot-detection server-side, so this is a plain,
 * reliable HTTP client — no browser, no scraping, no babysitting. Billing is
 * per QUERY (per tile).
 *
 * BILLING / QUOTA (from their docs, verified against live error headers):
 *   - Every request that passes auth + quota is metered, INCLUDING validation
 *     errors and upstream 5xx. 429s and unknown-endpoint 404s are never billed.
 *   - Responses carry X-Quota-Limit / X-Quota-Remaining / X-Quota-Reset and
 *     X-RateLimit-* — this relay logs them every tick so you see the burn-down
 *     instead of discovering exhaustion hours later.
 *   - A 429 with code=quota_exceeded does NOT clear on retry. Retrying is
 *     pointless noise, so this relay stops polling for a while and says so once.
 *
 * POLICE FILTERING — read this before trusting it:
 *   Their endpoint docs (wazeapi.com/docs/area-alerts) advertise an optional
 *   `filter` query param, e.g. filter=["POLICE"]. Reports from real use say the
 *   live API ignores or rejects it, so we do BOTH:
 *     1. send `filter` (configurable), and
 *     2. log the type breakdown of every response, which is the only honest way
 *        to tell whether the filter is actually honoured.
 *   If the API answers 400 to a filtered request, the filter is switched off
 *   (once, loudly) and we fall back to fetching all types and filtering locally
 *   — which is what has always happened, so nothing regresses.
 *   If it accepts the filter but the breakdown still shows ACCIDENT/HAZARD/JAM,
 *   then the param was ignored: the docs are wrong, and the log proves it.
 *
 * RESULT CAP: `limit` defaults to 500 (docs). Truncation matters because the cap
 * counts ALL alert types — in a dense box, police alerts can be squeezed out
 * entirely. This relay compares the response's `count` against what came back
 * and warns when a tile looks truncated.
 *
 * Env (.env): WAZEAPI_KEY, API_URL (the app), RELAY_SECRET (== WAZE_RELAY_SECRET),
 *   POLL_SECONDS (default 1800), optional WAZEAPI_TILES, WAZEAPI_FILTER
 *   (JSON array, default ["POLICE"], set to empty to send no filter),
 *   WAZEAPI_LIMIT (default 500), WAZEAPI_BASE, WAZEAPI_COUNTRY.
 *   Run:  node relay-wazeapi.mjs        (loop)   |   --once
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');
/** Pay-as-you-go ledger, written when the vendor reports a balance. */
const CREDIT_FILE = path.join(__dirname, 'waze-credit.json');
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
const WAZEAPI_LIMIT = Math.max(1, Number(process.env.WAZEAPI_LIMIT) || 500);
if (!API_URL)     { console.error('Missing API_URL (e.g. http://127.0.0.1:3100)'); process.exit(1); }
if (!RELAY_SECRET){ console.error('Missing RELAY_SECRET (must match WAZE_RELAY_SECRET on the app)'); process.exit(1); }
if (!WAZEAPI_KEY) { console.error('Missing WAZEAPI_KEY — get one free at https://wazeapi.com'); process.exit(1); }

/* WAZEAPI_FILTER: JSON array of alert types to request, or empty for none.
   Default ["POLICE"] — the server-side filter their docs promise. */
let FILTER = ['POLICE'];
if (process.env.WAZEAPI_FILTER !== undefined) {
  const raw = process.env.WAZEAPI_FILTER.trim();
  if (!raw) FILTER = [];
  else { try { const p = JSON.parse(raw); FILTER = Array.isArray(p) ? p : [String(p)]; }
         catch { console.warn(`[wazeapi] bad WAZEAPI_FILTER JSON (${raw}) — using ["POLICE"]`); } }
}
let filterInPlay = FILTER.length > 0;   // flipped off permanently if the API 400s on it

/* Victoria tiles as [name, bottom-left "lat,lng", top-right "lat,lng"].
   Per-query billing → fewer tiles = cheaper. Override with WAZEAPI_TILES
   (JSON: [["name","blat,blng","tlat,tlng"],...]). */
const DEFAULT_TILES = [
  // 8-box mosaic over central, inner-east, east and the south-east corridor.
  // Each box ~14 x 11 km. Kept tight because the result cap counts ALL alert
  // types, so a sprawling box can push POLICE out of the response entirely.
  ['CBD',           '-37.875,144.895', '-37.745,145.025'],
  ['Inner SE',      '-37.965,144.985', '-37.835,145.115'],
  ['Box Hill East', '-37.885,145.055', '-37.755,145.185'],
  ['Glen Waverley', '-37.965,145.135', '-37.835,145.265'],
  ['Dandenong',     '-38.065,145.145', '-37.935,145.275'],
  ['Ringwood',      '-37.895,145.185', '-37.765,145.315'],
  ['Casey',         '-38.125,145.255', '-37.995,145.385'],
  ['Pakenham',      '-38.155,145.395', '-38.025,145.525'],
];
let TILES = DEFAULT_TILES;
try { if (process.env.WAZEAPI_TILES) TILES = JSON.parse(process.env.WAZEAPI_TILES); } catch { console.warn('[wazeapi] bad WAZEAPI_TILES JSON, using defaults'); }

/* A swapped or malformed corner returns an empty result set, which looks exactly
   like "no police about" — so refuse to run with a broken box rather than lie. */
function validateTiles(tiles) {
  const bad = [];
  for (const t of tiles) {
    if (!Array.isArray(t) || t.length !== 3) { bad.push(`${JSON.stringify(t)}: not [name, bottom-left, top-right]`); continue; }
    const [name, bl, tr] = t;
    const p = (s) => String(s).split(',').map(Number);
    const [blat, blng] = p(bl); const [tlat, tlng] = p(tr);
    if (![blat, blng, tlat, tlng].every(Number.isFinite)) { bad.push(`${name}: unparseable coords "${bl}" / "${tr}"`); continue; }
    if (blat >= tlat) bad.push(`${name}: bottom-left lat ${blat} must be SOUTH of top-right ${tlat}`);
    if (blng >= tlng) bad.push(`${name}: bottom-left lng ${blng} must be WEST of top-right ${tlng}`);
    if (blng < -180 || tlng > 180 || blat < -90 || tlat > 90) bad.push(`${name}: coords out of range`);
  }
  return bad;
}
const tileProblems = validateTiles(TILES);
if (tileProblems.length) {
  console.error('[tiles] refusing to start — malformed bounding box(es):');
  for (const p of tileProblems) console.error(`  - ${p}`);
  process.exit(1);
}

const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const isPolice = (t) => String(t||'').toUpperCase().startsWith('POLICE');

// ── quota bookkeeping, surfaced in the logs ────────────────────────────────
const quota = { limit: null, remaining: null, reset: null, rateLimit: null, rateRemaining: null };
// Pay-as-you-go burn-down. Confirmed by the vendor (2026-09-16): once the trial
// allowance is gone and a request is paid from the balance, every response also
// carries these two. X-Quota-* keeps describing the PLAN allowance only, so in
// that state it reads "0 left (resets never)" while the balance is what is
// actually being spent — hence reading both, and reporting them separately.
const credit = { costUsd: null, balanceUsd: null, firstBalanceUsd: null, prevBalanceUsd: null, at: null };
function readQuotaHeaders(h) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const q = num(h.get('x-quota-limit'));            if (q !== null) quota.limit = q;
  const r = num(h.get('x-quota-remaining'));        if (r !== null) quota.remaining = r;
  const rr = num(h.get('x-ratelimit-remaining'));   if (rr !== null) quota.rateRemaining = rr;
  const rl = num(h.get('x-ratelimit-limit'));       if (rl !== null) quota.rateLimit = rl;
  const rs = h.get('x-quota-reset');                if (rs) quota.reset = rs;
  const cc = num(h.get('x-credit-cost-usd'));       if (cc !== null) credit.costUsd = cc;
  const cb = num(h.get('x-credit-balance-usd'));
  if (cb !== null && cb !== credit.balanceUsd) {
    credit.prevBalanceUsd = credit.balanceUsd;
    credit.balanceUsd = cb;
    credit.at = new Date().toISOString();
    if (credit.firstBalanceUsd === null) credit.firstBalanceUsd = cb;
    writeCreditState();
  }
}
const quotaSummary = () =>
  quota.limit === null && quota.remaining === null
    ? 'quota: unknown (no X-Quota-* headers seen)'
    : `quota: ${quota.remaining ?? '?'}/${quota.limit ?? '?'} left${quota.reset ? ` (resets ${quota.reset})` : ''}`;
/** "credit: $9.9980 left (-$0.0020/req)" — blank until a balance has been seen. */
const creditSummary = () => {
  if (credit.balanceUsd === null) return '';
  const cost = credit.costUsd === null ? '' : ` (-$${credit.costUsd.toFixed(4)}/req)`;
  let burn = '';
  if (credit.firstBalanceUsd !== null && credit.balanceUsd < credit.firstBalanceUsd) {
    const spent = credit.firstBalanceUsd - credit.balanceUsd;
    const days = (Date.now() - Date.parse(credit.atStart ?? credit.at)) / 86400000;
    if (days > 0.01) burn = ` | burn $${(spent / days).toFixed(2)}/day`;
  }
  return ` | credit: $${credit.balanceUsd.toFixed(4)} left${cost}${burn}`;
};
function writeCreditState() {
  try {
    const p = CREDIT_FILE;
    const prev = (() => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } })();
    const first = prev.firstBalanceUsd ?? credit.balanceUsd;
    const firstAt = prev.firstAt ?? credit.at;
    credit.atStart = firstAt;
    fs.writeFileSync(p, JSON.stringify({
      firstBalanceUsd: first, firstAt, lastBalanceUsd: credit.balanceUsd,
      lastCostUsd: credit.costUsd, lastAt: credit.at,
      spentUsd: Number((first - credit.balanceUsd).toFixed(4)),
    }, null, 2));
  } catch { /* the ledger is a convenience; never let it break a tick */ }
}

/** A quota error is NOT transient — it will not clear by retrying. */
class QuotaError extends Error { constructor(m){ super(m); this.quota = true; } }
let quotaPausedUntil = 0;          // skip network work entirely while paused
let quotaNoted = false;            // only shout about it once per outage
let quotaPauseAnnouncedAt = 0;     // heartbeat while paused, but not every tick

async function fetchTile([name, bl, tr], attempt = 1, withFilter = filterInPlay) {
  if (Date.now() < quotaPausedUntil) throw new QuotaError(`${name}: skipped (quota paused)`);

  const params = new URLSearchParams({
    'bottom-left': bl,
    'top-right': tr,
    limit: String(WAZEAPI_LIMIT),
  });
  if (withFilter && FILTER.length) params.set('filter', JSON.stringify(FILTER));
  const url = `${WAZEAPI_BASE}/alerts?${params}`;

  let r;
  try {
    r = await fetch(url, { headers: { 'X-API-Key': WAZEAPI_KEY, 'X-Country': WAZEAPI_COUNTRY, 'Accept':'application/json' }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    if (attempt < 3) { await sleep(1500*attempt); return fetchTile([name,bl,tr], attempt+1, withFilter); }
    throw new Error(`${name}: network ${e.message}`);
  }
  readQuotaHeaders(r.headers);

  // The advertised filter may simply not exist on the live API. Find out once,
  // loudly, then carry on without it rather than paying for a 400 every tick.
  if (r.status === 400 && withFilter) {
    filterInPlay = false;
    console.error(`[filter] WazeAPI returned HTTP 400 for filter=${JSON.stringify(FILTER)} — the server-side police filter their docs advertise is not accepted. Falling back to requesting ALL alert types and filtering locally (same cost per request). Set WAZEAPI_FILTER= to silence this.`);
    return fetchTile([name, bl, tr], attempt, false);
  }

  if (r.status === 429) {
    let body = ''; try { body = await r.text(); } catch {}
    let code = '', message = '', upgrade = '';
    try { const j = JSON.parse(body); code = j?.error?.code || ''; message = j?.error?.message || ''; upgrade = j?.error?.upgrade_url || ''; } catch {}
    if (code === 'quota_exceeded' || /quota/i.test(message)) {
      quotaPausedUntil = Date.now() + 30 * 60 * 1000;   // re-check in 30 min
      throw new QuotaError(`${name}: ${message || 'quota exhausted'}${upgrade ? ` — ${upgrade}` : ''}`);
    }
    // genuine per-second rate limit — it does clear
    if (attempt < 3) { await sleep(1500*attempt); return fetchTile([name,bl,tr], attempt+1, withFilter); }
    throw new Error(`${name}: HTTP 429 rate_limited after retries`);
  }
  if (r.status === 401 || r.status === 403) throw new Error(`${name}: HTTP ${r.status} — check WAZEAPI_KEY (${(await r.text().catch(()=>'')).slice(0,120)})`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status >= 500 ? ' (upstream — billed, retrying)' : ''}`);
  if (r.status >= 500 && attempt < 3) { await sleep(2000*attempt); return fetchTile([name,bl,tr], attempt+1, withFilter); }

  let data;
  try { data = await r.json(); } catch (e) { throw new Error(`${name}: bad JSON (${e.message})`); }
  const alerts = Array.isArray(data) ? data : (Array.isArray(data?.alerts) ? data.alerts : []);
  // `count` is the total the API says matched. If it exceeds what we received,
  // the result cap bit and something (possibly POLICE) was dropped.
  const reportedCount = Array.isArray(data) ? null : (Number(data?.count) ?? null);

  const types = {};
  for (const a of alerts) { const t = String(a.type || 'UNKNOWN').toUpperCase(); types[t] = (types[t] || 0) + 1; }

  const police = alerts.filter(a => isPolice(a.type)).map(a => {
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

  return { name, police, types, returned: alerts.length, reportedCount };
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
  const t0 = Date.now();
  const merged = new Map();
  let ok = 0, fail = 0, quotaFails = 0, truncated = 0;
  const allTypes = {};
  let sawAny = false;

  for (const tile of TILES) {
    try {
      const res = await fetchTile(tile);
      sawAny = true;
      for (const [t, n] of Object.entries(res.types)) allTypes[t] = (allTypes[t] || 0) + n;
      if (res.reportedCount !== null && res.reportedCount > res.returned) {
        truncated++;
        console.error(`[cap] ${res.name}: API reported count=${res.reportedCount} but returned ${res.returned} (limit ${WAZEAPI_LIMIT}) — results were truncated, so POLICE alerts may be missing. Shrink this tile.`);
      }
      for (const a of res.police) merged.set(a.uuid, a);
      ok++;
    } catch (e) {
      if (e.quota) { quotaFails++; if (!quotaNoted) { quotaNoted = true; console.error(`[quota] ${e.message}`); } }
      else { fail++; console.error(`[tile] ${e.message}`); }
    }
  }

  const when = new Date().toISOString();
  if (quotaFails && quotaFails === TILES.length) {
    // Heartbeat while blocked. Silence here would be indistinguishable from a dead
    // relay to anything watching the log (the VP-Overwatch watchdog alerts on
    // journal silence), so announce at most every 15 min — which on a 20-minute
    // poll means roughly every tick, keeping a wide margin under that watchdog's
    // 45-minute silence threshold.
    if (!quotaPauseAnnouncedAt || Date.now() - quotaPauseAnnouncedAt > 15 * 60 * 1000) {
      quotaPauseAnnouncedAt = Date.now();
      console.error(`[${when}] paused: WazeAPI quota exhausted — nothing fetched. Top up or add credits (https://wazeapi.com/pricing); the relay resumes automatically and re-checks every 30 min until then.`);
    }
    if (ONCE) process.exitCode = 1;
    return;
  }
  if (!ok) { console.error(`[${when}] all ${TILES.length} tiles failed`); if (ONCE) process.exitCode = 1; return; }
  if (sawAny) { quotaNoted = false; quotaPauseAnnouncedAt = 0; }

  const police = [...merged.values()];
  // The type breakdown is how we PROVE whether the server-side filter is real.
  const breakdown = Object.entries(allTypes).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`${t}=${n}`).join(' ') || 'none';
  const nonPolice = Object.entries(allTypes).filter(([t]) => !isPolice(t)).reduce((s,[,n]) => s+n, 0);
  const filterNote = filterInPlay
    ? (nonPolice > 0 ? `filter=${JSON.stringify(FILTER)} IGNORED (received ${nonPolice} non-police alerts — their docs are wrong; filtering locally)` : `filter=${JSON.stringify(FILTER)} honoured`)
    : 'filter=off (all types fetched, police selected locally)';

  if (!police.length) {
    console.log(`[${when}] no police alerts (${ok}/${TILES.length} tiles ok) | types: ${breakdown} | ${filterNote} | ${quotaSummary()}${creditSummary()}${truncated ? ` | ${truncated} tile(s) truncated` : ''}`);
    return;
  }
  try {
    const res = await pushAlerts(police);
    console.log(`[${when}] ingested ${res.ingested ?? '?'}/${police.length} police (${ok}/${TILES.length} tiles, ${Date.now()-t0}ms) | types: ${breakdown} | ${filterNote} | ${quotaSummary()}${creditSummary()}${truncated ? ` | ${truncated} tile(s) truncated` : ''}`);
  } catch (e) { console.error(`[push] ${e.message}`); if (ONCE) process.exitCode = 1; }
}

console.log(`WazeAPI POLICE relay → ${API_URL} | country=${WAZEAPI_COUNTRY} | ${TILES.length} VIC tiles${ONCE?' (--once)':`, every ${POLL_SECONDS}s`}`);
console.log(`  limit=${WAZEAPI_LIMIT} | filter=${FILTER.length ? JSON.stringify(FILTER) : 'off'} | tiles: ${TILES.map(t=>t[0]).join(', ')}`);
await tick();
if (!ONCE) setInterval(tick, POLL_SECONDS*1000);
