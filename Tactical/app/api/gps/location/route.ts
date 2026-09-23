import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * Last-received browser position — NOT a public endpoint.
 *
 * The store keeps ONE position for the whole process (every client's
 * `POST /api/gps/set` overwrites it), so this route was serving the most recent
 * visitor's location to anyone who asked: unauthenticated, any origin, no
 * provenance. Whoever had most recently loaded the map — including the operator
 * — had their grid-snapped (~110 m) cell readable by a single curl, and the route
 * fell back to a configured default when the slot was empty, so it always
 * answered with a point.
 *
 * Same-origin only now, the pattern `/api/waze/alerts` uses: `Sec-Fetch-Site` is
 * set by the browser and cannot be set by JavaScript, so a third-party page
 * cannot read it; Origin/Referer is the fallback. A refusal is 404 rather than
 * 403 so a probe does not learn the endpoint exists.
 *
 * Nothing in the app calls this route. It is kept (gated) rather than deleted
 * only because a position slot with no way to read it is dead code either way —
 * if it is still unused at the next pass, delete it.
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

export async function GET(req: Request) {
  if (!isSameOrigin(req)) return new Response('Not found', { status: 404 })

  const store = getStore()
  const userLocation = store.getUserLocation()
  if (userLocation) {
    return Response.json(userLocation, {
      headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
    })
  }
  return Response.json(store.getGPS(), {
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  })
}
