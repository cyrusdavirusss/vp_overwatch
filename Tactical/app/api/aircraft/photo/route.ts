/**
 * Aircraft photo lookup — proxies the planespotters.net public photo API (the
 * same source tar1090 / adsbexchange / adsb.lol use) so the detail panel can
 * show a real photo of the selected tail.
 *
 * Server-side because:
 *   • planespotters requires a User-Agent carrying a contact URL/email
 *     (a plain UA is rejected) — set PLANESPOTTERS_UA to your own contact.
 *   • we cache per tail (24h hit / 6h miss) to stay well inside their rate limit.
 *
 * Their terms REQUIRE showing the photographer credit + linking back, so we
 * always return `photographer` + `link` and the UI renders the attribution.
 * Looks up by registration first (works for the VicPol tails), then by hex.
 */
export const dynamic = 'force-dynamic'

interface PhotoResult {
  src: string | null
  width?: number
  height?: number
  link?: string
  photographer?: string
}

const CACHE = new Map<string, { at: number; data: PhotoResult }>()
const HIT_TTL_MS = 24 * 3_600_000
const MISS_TTL_MS = 6 * 3_600_000

/**
 * Bounded. The cache key is caller-supplied (`?reg=` / `?hex=`), so an unbounded
 * Map let anyone create entries that live for six to twenty-four hours, each miss
 * costing an upstream lookup against a third party's rate limit. Cap the entry
 * count, and refuse keys that are not a registration or an ICAO hex.
 */
const MAX_CACHE_ENTRIES = 500
const KEY_SHAPE = /^([A-Z0-9-]{2,10}|[0-9a-f]{6})$/

function userAgent(): string {
  // planespotters rejects UAs without a contact URL/email. Override with your
  // own reachable contact via PLANESPOTTERS_UA in .env.local.
  return (
    process.env.PLANESPOTTERS_UA ||
    'vp-overwatch/1.0 (+https://github.com/; self-hosted tactical map)'
  )
}

async function lookup(path: string): Promise<PhotoResult | null> {
  try {
    const res = await fetch(`https://api.planespotters.net/pub/photos/${path}`, {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const j: any = await res.json()
    const p = j?.photos?.[0]
    if (!p) return null
    const img = p.thumbnail_large || p.thumbnail
    if (!img?.src) return null
    return {
      src: img.src,
      width: img.size?.width,
      height: img.size?.height,
      link: p.link,
      photographer: p.photographer,
    }
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reg = (searchParams.get('reg') || '').trim().toUpperCase()
  const hex = (searchParams.get('hex') || '').trim().toLowerCase()
  const key = reg || hex
  if (!key) return Response.json({ src: null } as PhotoResult)

  // Shape check BEFORE any cache or upstream work: a registration or a 6-digit
  // ICAO hex. Anything else is refused, so free-form input cannot become a
  // long-lived cache entry or a third-party lookup.
  if (!KEY_SHAPE.test(key)) {
    return Response.json({ src: null } as PhotoResult, { headers: { 'cache-control': 'no-store' } })
  }

  const now = Date.now()
  const cached = CACHE.get(key)
  if (cached && now - cached.at < (cached.data.src ? HIT_TTL_MS : MISS_TTL_MS)) {
    return Response.json(cached.data)
  }

  let result: PhotoResult | null = null
  if (reg) result = await lookup(`reg/${encodeURIComponent(reg)}`)
  if (!result && hex) result = await lookup(`hex/${encodeURIComponent(hex)}`)

  const data: PhotoResult = result || { src: null }
  // Evict oldest-first when full. Map preserves insertion order, and this cache
  // holds only public photo metadata, so dropping the oldest entries is free.
  if (CACHE.size >= MAX_CACHE_ENTRIES) {
    for (const k of CACHE.keys()) {
      CACHE.delete(k)
      if (CACHE.size < MAX_CACHE_ENTRIES) break
    }
  }
  CACHE.set(key, { at: now, data })
  return Response.json(data)
}
