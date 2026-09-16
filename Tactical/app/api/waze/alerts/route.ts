import { getStore } from '@/lib/store'
import type { Report } from '@/lib/data'

export const dynamic = 'force-dynamic'

/**
 * Ground contacts for the live map — deliberately NOT a public feed.
 *
 * WazeAPI's terms (confirmed by the vendor, 2026-09-16) allow republishing alert
 * locations on a community map, but ask that we "don't expose a public JSON
 * endpoint that re-serves our responses". This route used to return the store's
 * reports verbatim to anyone who asked, with no auth and no origin check, which
 * was precisely that.
 *
 * Two gates now:
 *
 *  1. SAME-ORIGIN ONLY, enforced with the browser's own `Sec-Fetch-Site` header.
 *     JavaScript cannot set that header, so a third-party page cannot make this
 *     request succeed; Origin/Referer is the fallback for older clients.
 *
 *  2. The payload is PROJECTED to the fields the UI actually draws — a point, a
 *     kind, an age, a label, the confidence values the detail panel shows — so
 *     what leaves here is render data rather than the vendor's records with all
 *     their metadata.
 *
 * RESIDUAL, stated plainly: a server-side scraper can spoof headers, so this is
 * not cryptographic protection, and report ids are the store's own keys (they
 * embed the vendor's uuid because the store derives them that way). If that
 * matters, the next step is to stop serving reports over HTTP entirely and render
 * them into the page. Flagged rather than implied.
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

/** Exactly what the map, the rail list and the detail panel read — nothing else. */
function project(r: Report): Partial<Report> {
  return {
    id: r.id,
    kind: r.kind,
    lat: r.lat,
    lng: r.lng,
    reportedAgo: r.reportedAgo,
    lastConfirmedAgo: r.lastConfirmedAgo,
    descr: r.descr,
    street: r.street,
    city: r.city,
    nThumbsUp: r.nThumbsUp,
    reliability: r.reliability,
    confidence: r.confidence,
  }
}

export async function GET(req: Request) {
  // 404 rather than 403: a probe should not learn that the endpoint exists.
  if (!isSameOrigin(req)) return new Response('Not found', { status: 404 })

  const reports = getStore().getReports().map(project)
  return Response.json(reports, {
    headers: {
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}
