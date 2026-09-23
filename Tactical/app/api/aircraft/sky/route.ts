import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * All airborne contacts (law-enforcement + civil) in range, for the AR sky view.
 * Each carries a `category` of 'le' | 'civil' so the client can colour-code and
 * distinguish police from civilian traffic.
 *
 * The ORDER is "nearest the caller first", because the result is capped and the
 * caller only cares about what is overhead THEM. That origin used to be read from
 * the store's single position slot, which any visitor can overwrite — so one
 * visitor's push decided what another visitor's sky list contained. It now comes
 * from the request (`?lat=&lng=`, clamped to the coverage box); the stored slot is
 * only a fallback for a caller that does not supply one. Nothing in the response
 * depends on the origin except the order, so an absent or spoofed origin cannot
 * leak anything — it can only reorder a public list.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const lat = Number(url.searchParams.get('lat'))
  const lng = Number(url.searchParams.get('lng'))
  const origin = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined

  const store = getStore()
  const aircraft = await store.getSkyContacts(80, origin)
  return Response.json(aircraft, {
    headers: { 'cache-control': 'no-store' },
  })
}
