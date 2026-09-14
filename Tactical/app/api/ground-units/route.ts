import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

export interface GroundUnit {
  id: string
  type: 'POLICE' | 'SUPPORT' | 'COMMAND'
  subtype?: string
  callsign?: string
  unitNumber?: string
  location: {
    lat: number
    lon: number
    street?: string
    suburb?: string
  }
  status: 'ACTIVE' | 'PATROL' | 'INCIDENT' | 'STANDBY'
  lastUpdate: number
  metadata?: Record<string, unknown>
}

export async function GET() {
  const store = getStore()
  const units = store.getGroundUnits()
  return Response.json(units)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const store = getStore()
    
    // Validate required fields
    if (!body.location?.lat || !body.location?.lon) {
      return Response.json(
        { error: 'Invalid location: lat/lon required' },
        { status: 400 }
      )
    }
    
    const unit: GroundUnit = {
      id: body.id || `unit-${Date.now()}`,
      type: body.type || 'POLICE',
      subtype: body.subtype,
      callsign: body.callsign,
      unitNumber: body.unitNumber,
      location: {
        lat: body.location.lat,
        lon: body.location.lon,
        street: body.location.street,
        suburb: body.location.suburb,
      },
      status: body.status || 'ACTIVE',
      lastUpdate: Date.now(),
      metadata: body.metadata,
    }
    
    store.addGroundUnit(unit)
    
    return Response.json(unit, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: 'Failed to create ground unit', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { id, ...updates } = await request.json()
    const store = getStore()
    
    const updated = store.updateGroundUnit(id, updates)
    if (!updated) {
      return Response.json({ error: 'Ground unit not found' }, { status: 404 })
    }
    
    return Response.json(updated)
  } catch (error) {
    return Response.json(
      { error: 'Failed to update ground unit', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return Response.json({ error: 'Unit ID required' }, { status: 400 })
    }
    
    const store = getStore()
    const deleted = store.removeGroundUnit(id)
    
    if (!deleted) {
      return Response.json({ error: 'Ground unit not found' }, { status: 404 })
    }
    
    return Response.json({ success: true, id })
  } catch (error) {
    return Response.json(
      { error: 'Failed to delete ground unit', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/** Bulk ingest endpoint for Waze relay — accepts array of ground units */
export async function POST_bulk(request: Request) {
  try {
    const units = await request.json()
    if (!Array.isArray(units)) {
      return Response.json({ error: 'Expected array of ground units' }, { status: 400 })
    }
    
    const store = getStore()
    const result = store.bulkIngestGroundUnits(units)
    
    return Response.json(result, { status: 200 })
  } catch (error) {
    return Response.json(
      { error: 'Bulk ingest failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}