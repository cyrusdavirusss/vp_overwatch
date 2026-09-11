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

  const now = Date.now()
  const cached = CACHE.get(key)
  if (cached && now - cached.at < (cached.data.src ? HIT_TTL_MS : MISS_TTL_MS)) {
    return Response.json(cached.data)
  }

  let result: PhotoResult | null = null
  if (reg) result = await lookup(`reg/${encodeURIComponent(reg)}`)
  if (!result && hex) result = await lookup(`hex/${encodeURIComponent(hex)}`)

  const data: PhotoResult = result || { src: null }
  CACHE.set(key, { at: now, data })
  return Response.json(data)
}
