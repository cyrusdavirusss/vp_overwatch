import { getStore } from '@/lib/store'
import { rateLimit, rateLimitIp, clientIp } from '@/lib/auth/rate-limit'
import { isIP } from 'node:net'

export const dynamic = 'force-dynamic'

/**
 * IP geolocation for a visitor's OWN address — not a public endpoint.
 *
 * What it used to do: read `X-Forwarded-For` straight off the request, interpolate
 * it into an `ip-api.com` URL, and store the answer in the process-wide GPS slot.
 * Three problems, all fixed here:
 *
 *  1. UNAUTHENTICATED AND ANY-ORIGIN. Anyone could call it, from any page, at any
 *     rate. It is now same-origin only (the `Sec-Fetch-Site` pattern
 *     `/api/waze/alerts` and `/api/gps/location` use) and rate limited.
 *
 *  2. THE HEADER WAS TRUSTED BLINDLY and used unvalidated as a URL component — so
 *     a caller could push a string of their choosing into the outbound request, and
 *     the `query` field echoed it back. The caller's IP now comes from the
 *     trusted-proxy-aware `clientIp()` helper and must parse as a globally
 *     routable literal address (`isIP` + private/loopback/link-local/CGNAT
 *     rejection) before it is used.
 *
 *  3. NO-IP LOOKUP LEAKED THE SERVER'S OWN POSITION. With no usable caller IP the
 *     old code called `ip-api.com/json/` with no address, which geolocates the
 *     CALLER OF THAT REQUEST — i.e. this server — and then wrote it into the shared
 *     GPS slot and returned it. A missing IP now returns the fallback, never a
 *     lookup of ourselves.
 *
 * Nothing in the app calls this route: the map uses the browser's own geolocation
 * (`useClientLocation`) and pushes it to `/api/gps/set`. It is kept gated rather
 * than deleted only because that is a product call — an unused route with a
 * position side effect is the next thing to remove.
 */
function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin' || site === 'none'
  const ref = req.headers.get('origin') || req.headers.get('referer')
  if (!ref) return false
  try {
    return new URL(ref).host === req.headers.get('host')
  } catch {
    return false
  }
}

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' }

/**
 * A literal, globally routable address — or null. Deliberately coarse: the point
 * is to refuse anything that is not a real public IP, not to be a perfect
 * implementation of the bogon list.
 */
function publicIpOrNull(ip: string): string | null {
  if (!ip || ip === 'untrusted') return null
  const kind = isIP(ip)
  if (kind === 0) return null

  if (kind === 4) {
    const o = ip.split('.').map(Number)
    if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
    const [a, b] = o
    if (a === 0 || a === 10 || a === 127) return null
    if (a === 172 && b >= 16 && b <= 31) return null
    if (a === 192 && b === 168) return null
    if (a === 169 && b === 254) return null
    if (a === 100 && b >= 64 && b <= 127) return null      // CGNAT
    if (a >= 224) return null                              // multicast / reserved
    return ip
  }

  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return null
  if (lower.startsWith('fc') || lower.startsWith('fd')) return null   // unique-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return null // link-local
  return ip
}

export async function GET(request: Request) {
  // 404 rather than 403: a probe should not learn the endpoint exists.
  if (!isSameOrigin(request)) return new Response('Not found', { status: 404 })

  const ip = clientIp(request.headers)
  const ipRl = rateLimitIp(ip, 'gps-geoip', 30, 60)
  const globalRl = rateLimit('gps-geoip:global', 300, 60)
  if (!ipRl.allowed || !globalRl.allowed) {
    return Response.json({ error: 'rate_limited' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(Math.max(ipRl.retryAfterSec, globalRl.retryAfterSec)) } })
  }

  const store = getStore()
  const current = store.getGPS()
  const lat0 = Number(process.env.NEXT_PUBLIC_HOME_LAT) || -37.8136
  const lng0 = Number(process.env.NEXT_PUBLIC_HOME_LNG) || 144.9631
  const isDefault =
    Math.abs(current.lat - lat0) < 0.001 && Math.abs(current.lng - lng0) < 0.001

  // A real browser-GPS lock outranks an IP guess.
  if (!isDefault && current.accuracy < 100) {
    return Response.json({ ...current, source: 'gps' }, { headers: NO_STORE })
  }

  const lookupIp = publicIpOrNull(ip)
  if (!lookupIp) {
    // No identifiable caller IP. Do NOT fall through to a no-address lookup: that
    // resolves to THIS server's egress location.
    return Response.json({ ...current, source: 'fallback' }, { headers: NO_STORE })
  }

  try {
    const res = await fetch(
      `http://ip-api.com/json/${lookupIp}?fields=status,lat,lon,city`,   // no `query`: do not echo the IP
      { signal: AbortSignal.timeout(5_000) },
    )
    const data = await res.json()

    if (data.status === 'success' && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
      const geo: typeof current & { source: string; city?: string } = {
        lat: data.lat,
        lng: data.lon,
        hdg: 0,
        accuracy: 5000, // IP geo is ~5 km accurate
        source: 'ipgeo',
        city: typeof data.city === 'string' ? data.city : undefined,
      }

      // Only move the poll centre while it still sits on the default.
      if (Math.abs(current.lat - lat0) < 0.001 && Math.abs(current.lng - lng0) < 0.001) {
        store.setGPS(geo.lat, geo.lng, geo.hdg, geo.accuracy)
      }

      return Response.json(geo, { headers: NO_STORE })
    }
  } catch {
    // Fall through to the default below.
  }

  return Response.json({ ...current, source: 'fallback' }, { headers: NO_STORE })
}
