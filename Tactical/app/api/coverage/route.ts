/**
 * GET /api/coverage — the WazeAPI police boxes this app is actually paying to poll.
 *
 * LOCAL ONLY, BY DESIGN. This is an operator tool for deciding whether to buy more
 * coverage, not a public feature: the public site should not publish the collection
 * footprint. Two independent gates, because one is not enough when a tunnel is in front:
 *
 *   1. any Cloudflare header (cf-ray / cf-connecting-ip) means the request came through
 *      the public tunnel -> 404;
 *   2. the Host must be localhost or a private address -> otherwise 404.
 *
 * It reads tools/waze-relay/.env rather than a copy, so ADDING A BOX TO THE RELAY is what
 * makes it appear here. A duplicated list would drift the moment someone edits the relay,
 * and the whole point of this endpoint is to answer "what am I covering, and what would
 * one more box cost".
 */
import { NextResponse, type NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

/** Per-request price, verified from the vendor's own headers: $0.0020. */
const USD_PER_REQUEST = 0.002
const DAYS = 30

interface TileSpec { name: string; south: number; west: number; north: number; east: number }

/** [name, "lat,lng" bottom-left, "lat,lng" top-right] — the relay's own format. */
function parseTiles(raw: string): TileSpec[] {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  const out: TileSpec[] = []
  for (const t of parsed) {
    if (!Array.isArray(t) || t.length < 3) continue
    const [name, bl, tr] = t
    const [s, w] = String(bl).split(',').map(Number)
    const [n, e] = String(tr).split(',').map(Number)
    if (![s, w, n, e].every(Number.isFinite)) continue
    out.push({ name: String(name), south: s, west: w, north: n, east: e })
  }
  return out
}

function envFrom(file: string): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) env[m[1]] = m[2]
    }
  } catch { /* fall through to empty: the route reports what it could not read */ }
  return env
}

function isLocalOnly(req: NextRequest): boolean {
  // Any Cloudflare marker means this came in through the public tunnel.
  for (const h of ['cf-ray', 'cf-connecting-ip', 'cf-worker']) {
    if (req.headers.get(h)) return false
  }
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(':')[0].replace(/^\[|\]$/g, '')
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)
}

/**
 * Find the relay's .env by walking up from the current working directory.
 *
 * process.cwd() is NOT the app directory: the standalone server runs from .next, so a
 * single '../tools/...' guess resolved to .next/tools/... and found nothing. Candidates are
 * tried in order and the one that worked is reported, so a wrong path is visible in the
 * response instead of silently producing no boxes.
 */
function findRelayEnv(): { path: string | null; tried: string[] } {
  const override = process.env.VP_WAZE_RELAY_ENV
  const tried: string[] = []
  const bases: string[] = override ? [override] : []
  let dir = process.cwd()
  for (let up = 0; up < 5; up++) {
    bases.push(path.join(dir, 'tools', 'waze-relay', '.env'))
    dir = path.dirname(dir)
  }
  for (const candidate of bases) {
    tried.push(candidate)
    try { readFileSync(candidate); return { path: candidate, tried } } catch { /* next */ }
  }
  return { path: null, tried }
}

export async function GET(req: NextRequest) {
  if (!isLocalOnly(req)) {
    // 404 rather than 403: a probe should not learn that this exists.
    return new NextResponse('Not found', { status: 404 })
  }

  const found = findRelayEnv()
  const env = found.path ? envFrom(found.path) : {}
  const tiles = parseTiles(env.WAZEAPI_TILES || '[]')
  const pollSeconds = Number(env.POLL_SECONDS) > 0 ? Number(env.POLL_SECONDS) : 1800

  if (tiles.length === 0) {
    return NextResponse.json({
      error: 'no_tiles',
      reason: found.path
        ? `Read ${found.path} but found no usable WAZEAPI_TILES.`
        : `Could not find the relay's .env. Tried: ${found.tried.join(', ')}`,
      tiles: [],
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  }

  const requestsPerTilePerMonth = (86_400 / pollSeconds) * DAYS
  const usdPerTilePerMonth = requestsPerTilePerMonth * USD_PER_REQUEST

  const features = tiles.map((t) => ({
    type: 'Feature' as const,
    properties: {
      name: t.name,
      monthlyUsd: Number(usdPerTilePerMonth.toFixed(2)),
      // Label text is assembled here so the map layer needs no arithmetic.
      label: `${t.name} · $${usdPerTilePerMonth.toFixed(2)}/mo`,
    },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[
        [t.west, t.south], [t.east, t.south], [t.east, t.north], [t.west, t.north], [t.west, t.south],
      ]],
    },
  }))

  return NextResponse.json({
    tiles: tiles.length,
    pollSeconds,
    relayEnv: found.path,
    requestsPerMonth: Math.round(requestsPerTilePerMonth * tiles.length),
    monthlyUsd: Number((usdPerTilePerMonth * tiles.length).toFixed(2)),
    usdPerTilePerMonth: Number(usdPerTilePerMonth.toFixed(2)),
    features: { type: 'FeatureCollection', features },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
