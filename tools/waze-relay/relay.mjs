#!/usr/bin/env node
/**
 * VP-Overwatch — Waze ground-units relay
 *
 * Polls Waze's live-map alert feed for Victoria and forwards alerts to the
 * VP-Overwatch app (POST /api/waze/ingest). Must run from a residential ISP
 * IP — Waze blocks datacenter ranges. No dependencies (Node 18+ only).
 *
 * Two run modes:
 *   node relay.mjs           → loop forever, polling every POLL_SECONDS
 *   node relay.mjs --once    → single poll then exit (use with a scheduler)
 *
 * The Windows Scheduled Task installed by install-task.ps1 uses --once and
 * fires every 10 minutes, so the app self-updates on that cadence.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONCE = process.argv.includes("--once");

/* ── Load .env (no dotenv dependency) ──────────────────────────────────── */
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
const POLL_SECONDS = Math.max(30, Number(process.env.POLL_SECONDS) || 600);

if (!API_URL) {
  console.error("Missing API_URL (e.g. http://100.94.31.125:3100)");
  process.exit(1);
}
if (!RELAY_SECRET) {
  console.error("Missing RELAY_SECRET — must match WAZE_RELAY_SECRET on the app side");
  process.exit(1);
}

/* ── Victoria bounding box, tiled (Waze caps results per request) ───────── */
const BOUNDS = [
  { name: "Melbourne metro",     top: -37.55, bottom: -38.30, left: 144.50, right: 145.60 },
  { name: "Geelong / Bellarine", top: -37.95, bottom: -38.55, left: 143.85, right: 144.60 },
  { name: "Ballarat / Bendigo",  top: -36.50, bottom: -37.95, left: 143.50, right: 144.80 },
  { name: "Gippsland",           top: -37.30, bottom: -38.95, left: 145.50, right: 148.50 },
  { name: "NE Victoria",         top: -35.90, bottom: -37.20, left: 145.00, right: 147.90 },
  { name: "Wimmera / Mallee",    top: -34.10, bottom: -37.30, left: 140.95, right: 143.80 },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchTile(b) {
  const url = `https://www.waze.com/live-map/api/georss?top=${b.top}&bottom=${b.bottom}&left=${b.left}&right=${b.right}&env=row&types=alerts`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-AU,en;q=0.9",
      "Referer": "https://www.waze.com/live-map/",
      "Origin": "https://www.waze.com",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
  });
  if (!r.ok) throw new Error(`Waze ${b.name}: HTTP ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    const txt = await r.text();
    throw new Error(`Waze ${b.name}: non-JSON response (${txt.slice(0, 80)})`);
  }
  const data = await r.json();
  return Array.isArray(data?.alerts) ? data.alerts : [];
}

async function pushAlerts(alerts) {
  const r = await fetch(`${API_URL}/api/waze/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-relay-secret": RELAY_SECRET },
    body: JSON.stringify({ alerts }),
  });
  if (!r.ok) throw new Error(`Ingest: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

async function tick() {
  const startedAt = Date.now();
  let total = 0;
  let tileErrors = 0;
  const merged = new Map();
  for (const b of BOUNDS) {
    try {
      const alerts = await fetchTile(b);
      for (const a of alerts) if (a?.uuid) merged.set(a.uuid, a);
      total += alerts.length;
    } catch (e) {
      tileErrors++;
      console.warn(`[tile] ${b.name}: ${e.message}`);
    }
  }
  const unique = [...merged.values()];
  if (tileErrors === BOUNDS.length) {
    console.error(`[${new Date().toISOString()}] all ${BOUNDS.length} tiles failed — possible IP block or network error`);
    if (ONCE) process.exitCode = 1;
    return;
  }
  if (unique.length === 0) {
    console.log(`[${new Date().toISOString()}] no alerts (Waze returned 0 across ${BOUNDS.length - tileErrors} tiles)`);
    return;
  }
  try {
    const result = await pushAlerts(unique);
    const ms = Date.now() - startedAt;
    console.log(`[${new Date().toISOString()}] ${result.ingested}/${unique.length} ingested (raw ${total}) in ${ms}ms`);
  } catch (e) {
    console.error(`[push] ${e.message}`);
    if (ONCE) process.exitCode = 1;
  }
}

if (ONCE) {
  console.log(`Waze relay (one-shot) → ${API_URL}`);
  await tick();
  process.exit(process.exitCode || 0);
} else {
  console.log(`Waze relay (loop) → ${API_URL}, every ${POLL_SECONDS}s`);
  await tick();
  setInterval(tick, POLL_SECONDS * 1000);
}
