#!/usr/bin/env node
/**
 * Victoria Police Tracker — browser-based Waze relay (whole of Victoria)
 *
 * Waze's edge (Akamai) now 403s plain fetches, headless browsers, and injected
 * fetch() calls. Only the live-map page's OWN georss requests succeed, from a
 * real (non-headless) browser on a residential IP. So this relay drives one
 * real off-screen Chrome window, sweeps it across a set of viewport centres
 * covering Victoria, grabs each georss alert body the instant it arrives
 * (before eviction — the bug that broke earlier versions), and forwards
 * POLICE/CAMERA alerts to the tracker's ingest API.
 *
 * Snapshot every POLL_SECONDS (default 900 = 15 min). Set ONESHOT=1 to do a
 * single sweep, print the result, and exit (used to verify).
 *
 * Requirements: google-chrome, an X display (DISPLAY), Node 20+. No deps.
 *
 * Env: API_URL, RELAY_SECRET, POLL_SECONDS, DISPLAY, CDP_PORT, ONESHOT
 */
import { spawn } from 'node:child_process'

const API_URL = (process.env.API_URL || 'http://127.0.0.1:3010').replace(/\/+$/, '')
const RELAY_SECRET = process.env.RELAY_SECRET || 'dev-secret'
const POLL_SECONDS = Math.max(60, Number(process.env.POLL_SECONDS) || 900)
const ZOOM = Number(process.env.RELAY_ZOOM) || 9
const DISPLAY = process.env.DISPLAY || ':0'
const PORT = Number(process.env.CDP_PORT) || 9233
const ONESHOT = process.env.ONESHOT === '1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Viewport centres covering populated Victoria. At zoom 9 / 1200px the viewport
// is ~3.3deg wide, so a handful of centres blankets the state. The georss API
// returns individual alerts per viewport bbox (capped), so these overlap a bit.
const CENTRES = [
  { name: 'Melbourne metro + SE', lat: -37.95, lng: 145.20 },
  { name: 'West / Geelong / Ballarat', lat: -37.85, lng: 143.70 },
  { name: 'North / Bendigo / Shepparton', lat: -36.55, lng: 144.70 },
  { name: 'Gippsland / east', lat: -37.95, lng: 146.90 },
  { name: 'NE / Wodonga', lat: -36.30, lng: 146.60 },
  { name: 'NW / Mallee / Mildura', lat: -35.10, lng: 142.60 },
]

const chrome = spawn('google-chrome', [
  '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
  '--window-position=-3200,0', '--window-size=1200,900', // off-screen, real (non-headless)
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/waze-relay-profile', 'about:blank',
], { stdio: 'ignore', env: { ...process.env, DISPLAY } })

let ws, msgId = 0
const pending = new Map()
const isPoliceCamera = (a) => /POLICE|CAMERA/i.test((a.type || '') + ' ' + (a.subtype || ''))
let sweep = new Map()

const cdp = (method, params = {}) => new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json`)
      const t = await r.json()
      const p = t.find((x) => x.type === 'page')
      if (p?.webSocketDebuggerUrl) {
        ws = new WebSocket(p.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data)
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
          if (m.method === 'Network.responseReceived') {
            const r = m.params.response
            if (/georss/i.test(r.url) && r.status === 200) {
              // grab the body NOW, before it is evicted
              cdp('Network.getResponseBody', { requestId: m.params.requestId }).then((b) => {
                try {
                  const j = JSON.parse(b.body)
                  for (const a of (j?.alerts || [])) if (a?.uuid && isPoliceCamera(a)) sweep.set(a.uuid, a)
                } catch {}
              }).catch(() => {})
            }
          }
        }
        await cdp('Network.enable')
        await cdp('Page.enable')
        return
      }
    } catch {}
    await sleep(300)
  }
  throw new Error('could not attach to Chrome')
}

async function doSweep() {
  sweep = new Map()
  for (const c of CENTRES) {
    const url = `https://www.waze.com/en-GB/live-map/directions?latlng=${c.lat}%2C${c.lng}&zoom=${ZOOM}`
    await cdp('Page.navigate', { url })
    await sleep(7000) // load + georss fetch + body grab
  }
  await sleep(1500)
  return [...sweep.values()]
}

async function tick() {
  const alerts = await doSweep()
  if (alerts.length === 0) { console.log(`[${new Date().toISOString()}] sweep: 0 police/camera alerts`); return alerts }
  try {
    const r = await fetch(`${API_URL}/api/waze/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-relay-secret': RELAY_SECRET },
      body: JSON.stringify({ alerts }),
    })
    const j = await r.json().catch(() => ({}))
    console.log(`[${new Date().toISOString()}] ingested ${j.ingested ?? '?'}/${alerts.length} police/camera alerts across Victoria`)
  } catch (e) { console.error(`[push] ${e.message}`) }
  return alerts
}

console.log(`Victoria relay → ${API_URL}, ${CENTRES.length} centres z${ZOOM}, every ${POLL_SECONDS}s${ONESHOT ? ' (ONESHOT)' : ''}`)
await connect()
const first = await tick()
if (ONESHOT) {
  console.log('--- sample ---')
  for (const a of first.slice(0, 30)) console.log(`  ${a.type}/${a.subtype || '-'} @ ${a.location?.y?.toFixed(4)},${a.location?.x?.toFixed(4)} "${a.street || ''}"`)
  chrome.kill(); process.exit(0)
}
setInterval(tick, POLL_SECONDS * 1000)
