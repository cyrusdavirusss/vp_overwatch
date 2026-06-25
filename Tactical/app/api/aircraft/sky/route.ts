import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

// All airborne contacts (law-enforcement + civil) in range, for the AR sky view.
// Each carries a `category` of 'le' | 'civil' so the client can colour-code and
// distinguish police from civilian traffic.
export async function GET() {
  const store = getStore()
  const aircraft = await store.getSkyContacts()
  return Response.json(aircraft)
}
