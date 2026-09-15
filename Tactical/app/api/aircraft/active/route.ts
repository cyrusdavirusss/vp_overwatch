import { getStore } from '@/lib/store'
import { announceLabelFor } from '@/lib/adsb/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const store = getStore()
  const aircraft = await store.getAircraft()
  // Resolve the display name server-side ("King Air POL35") so the map shows
  // the same name the alerts speak, and the client needs no copy of the roster.
  const labelled = aircraft.map((a: { registration?: string }) => ({
    ...a,
    label: announceLabelFor(a.registration),
  }))
  return Response.json(labelled)
}
