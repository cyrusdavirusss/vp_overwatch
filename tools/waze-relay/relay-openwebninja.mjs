#!/usr/bin/env node
/**
 * VP-Overwatch — Waze relay via OpenWebNinja API
 *
 * Uses OpenWebNinja's managed Waze API for reliable, structured alert data.
 * Benefits:
 * - API key authentication (no browser impersonation needed)
 * - Structured JSON responses (no HTML/bot detection issues)
 * - Managed service reliability (provider handles WAF, scaling, uptime)
 * - No residential IP dependency
 *
 * Run modes:
 *   node relay-openwebninja.mjs       → loop forever
 *   node relay-openwebninja.mjs --once → single poll then exit
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONCE = process.argv.includes("--once");

/* ── Load .env ─────────────────────────────────────────────────────────── */
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const API_URL = (process.env.API_URL || "").replace(/\/+$/, "");
const RELAY_SECRET = process.env.RELAY_SECRET || "";
const OPENWEBNINJA_API_KEY = process.env.OPENWEBNINJA_API_KEY || "";
const POLL_SECONDS = Math.max(30, Number(process.env.POLL_SECONDS) || 600);

if (!API_URL) {
  console.error("Missing API_URL (e.g. http://100.94.31.125:3100)");
  process.exit(1);
}
if (!RELAY_SECRET) {
  console.error("Missing RELAY_SECRET — must match WAZE_RELAY_SECRET on the app side");
  process.exit(1);
}
if (!OPENWEBNINJA_API_KEY) {
  console.error("Missing OPENWEBNINJA_API_KEY — get one at https://app.openwebninja.com/api/waze");
  process.exit(1);
}

/* ── Victoria bounding box tiles (consolidated for token efficiency) ───── */
/* 
   Strategy: Use 3 large tiles covering all of Victoria to maximize token usage.
   Police-only alerts via alert_types parameter.
*/
const BOUNDS = [
  { 
    name: "Victoria West & Metro", 
    /* Covers: Melbourne metro, Geelong, Ballarat, Wimmera/Mallee */
    bottom_left: "-39.10,141.00", 
    top_right: "-37.50,145.70" 
  },
  { 
    name: "Victoria East & Gippsland", 
    /* Covers: Gippsland, NE Victoria */
    bottom_left: "-38.30,145.60", 
    top_right: "-35.90,148.50" 
  },
  { 
    name: "Victoria North & Central", 
    /* Covers: Bendigo region, central plains, northern boundaries */
    bottom_left: "-36.60,143.50", 
    top_right: "-34.10,146.00" 
  },
];

/* ── Fetch alerts from OpenWebNinja API ────────────────────────────────── */
async function fetchTileAlerts(bound) {
  const params = new URLSearchParams({
    bottom_left: bound.bottom_left,
    top_right: bound.top_right,
    alert_types: "POLICE", /* POLICE only — Victoria police tracker */
    max_alerts: "100", /* Maximum per tile */
    max_jams: "0",
    radius_units: "KM"
  });
  
  const url = `https://api.openwebninja.com/waze/alerts-and-jams?${params}`;
  
  const r = await fetch(url, {
    headers: {
      "x-api-key": OPENWEBNINJA_API_KEY,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  
  if (!r.ok) {
    const errorText = await r.text().catch(() => "unknown error");
    throw new Error(`OpenWebNinja ${bound.name}: HTTP ${r.status} — ${errorText.slice(0, 100)}`);
  }
  
  const data = await r.json();
  
  // OpenWebNinja API returns: { status: "OK", data: { alerts: [...], jams: [...] } }
  if (data.status !== "OK") {
    throw new Error(`OpenWebNinja ${bound.name}: ${data.error?.message || data.status || "API error"}`);
  }
  
  // Extract alerts using actual OpenWebNinja API field structure
  const alerts = (data.data?.alerts || []).map(alert => ({
    uuid: alert.alert_id || `${bound.name}-${alert.publish_datetime_utc}-${alert.latitude}-${alert.longitude}`,
    type: alert.type,
    subtype: alert.subtype,
    // Store reads location.x (lng) / location.y (lat), Waze-native, with a
    // top-level latitude/longitude fallback. Provide BOTH so coords never
    // resolve to undefined -> NaN (which crashes the MapLibre marker).
    location: { x: alert.longitude, y: alert.latitude },
    latitude: alert.latitude,
    longitude: alert.longitude,
    pubMillis: alert.publish_datetime_utc ? new Date(alert.publish_datetime_utc).getTime() : Date.now(),
    description: alert.description,
    reliability: alert.alert_reliability,
    confidence: alert.alert_confidence,
    nThumbsUp: alert.num_thumbs_up,
    city: alert.city,
    street: alert.street,
    country: alert.country,
  }));
  
  return alerts;
}

/* ── Push alerts to VP-Overwatch app ───────────────────────────────────── */
async function pushAlerts(alerts) {
  const r = await fetch(`${API_URL}/api/waze/ingest`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "x-relay-secret": RELAY_SECRET 
    },
    body: JSON.stringify({ alerts }),
    signal: AbortSignal.timeout(30000),
  });
  
  if (!r.ok) {
    const errorText = await r.text().catch(() => "unknown error");
    throw new Error(`Ingest: HTTP ${r.status} — ${errorText.slice(0, 100)}`);
  }
  
  return r.json();
}

/* ── Main tick ─────────────────────────────────────────────────────────── */
async function tick() {
  const startedAt = Date.now();
  let total = 0;
  let tileErrors = 0;
  const merged = new Map();
  
  for (const b of BOUNDS) {
    try {
      const alerts = await fetchTileAlerts(b);
      for (const a of alerts) {
        if (a?.uuid) merged.set(a.uuid, a);
      }
      total += alerts.length;
      console.log(`[tile] ${b.name}: ${alerts.length} alerts`);
    } catch (e) {
      tileErrors++;
      console.error(`[tile] ${b.name}: ${e.message}`);
    }
  }
  
  const unique = [...merged.values()];
  
  if (tileErrors === BOUNDS.length) {
    console.error(`[${new Date().toISOString()}] all ${BOUNDS.length} tiles failed — check API key and network`);
    if (ONCE) process.exitCode = 1;
    return;
  }
  
  if (unique.length === 0) {
    console.log(`[${new Date().toISOString()}] no alerts (OpenWebNinja returned 0 across ${BOUNDS.length - tileErrors} tiles)`);
    return;
  }
  
  try {
    const result = await pushAlerts(unique);
    const ms = Date.now() - startedAt;
    console.log(`[${new Date().toISOString()}] ${result.ingested}/${unique.length} ingested (raw ${total}) in ${ms}ms [OpenWebNinja API]`);
  } catch (e) {
    console.error(`[push] ${e.message}`);
    if (ONCE) process.exitCode = 1;
  }
}

/* ── Entry point ───────────────────────────────────────────────────────── */
console.log(`Waze relay (OpenWebNinja API) → ${API_URL}${ONCE ? " (--once)" : `, every ${POLL_SECONDS}s`}`);

if (ONCE) {
  await tick();
  process.exit(process.exitCode || 0);
} else {
  await tick();
  setInterval(tick, POLL_SECONDS * 1000);
}