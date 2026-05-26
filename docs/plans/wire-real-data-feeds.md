# VP-Overwatch: Wire Real Data Feeds

**Goal**: Replace all static mock data imports with live data from API routes, polling OpenSky Network for ADS-B, receiving Waze relay alerts, and accepting GPS position reports.

**Architecture**: In-memory server store → Next.js API routes → client-side polling hook → React state.

**Tech Stack**: Next.js API routes (no DB), OpenSky REST API (free tier, Melbourne bounding box), Waze relay script POSTs to `/api/waze/ingest`, frontend polls every 15-30s.

## Phase 1: In-Memory Data Store — `lib/store.ts`

A singleton server-side module that holds current state in memory:
- `aircraft: Map<string, ActiveHelicopter>` — active aircraft data from OpenSky
- `reports: Map<string, WazeAlert>` — Waze alerts keyed by uuid
- `userGPS: { lat, lng, hdg, accuracy, lastUpdate }` — phone GPS position
- `relayState: { lastTickAgo, pollIntervalSec, lastIngested, lastRaw, coverageRegions }`
- Methods: `updateAircraft()`, `upsertAlert()`, `pruneExpired()`, `setGPS()`, `getAllAircraft()`, `getAllReports()`, `getGPS()`, `getRelayState()`

## Phase 2: API Routes

### `app/api/healthz/route.ts`
GET → `{ status: 'ok' }`

### `app/api/waze/ingest/route.ts`
POST → receives `{ alerts: WazeRawAlert[] }` with `x-relay-secret` header, upserts into in-memory store, returns `{ ingested: number }`

### `app/api/waze/alerts/route.ts`
GET → returns processed reports array matching `Report[]` interface from `lib/data.ts`

### `app/api/aircraft/active/route.ts`
GET → triggers OpenSky poll (if stale), returns active aircraft matching `Aircraft[]` interface. Use `https://opensky-network.org/api/states/all?lamin=-38.5&lamax=-36.5&lomin=144.0&lomax=146.0` for Victoria bounding box.

### `app/api/aircraft/breadcrumbs/[hex]/route.ts`
GET → returns position breadcrumb array for a given hex.

### `app/api/gps/report/route.ts`
POST → receives `{ lat, lng, hdg, accuracy }`, stores in memory.

### `app/api/gps/location/route.ts`
GET → returns current GPS position.

## Phase 3: Client-Side Hook — `hooks/useRealtimeData.ts`

Custom hook that:
- Polls `/api/aircraft/active` every 30s
- Polls `/api/waze/alerts` every 15s  
- Polls `/api/gps/location` every 10s
- Returns `{ aircraft, reports, user, relay }` matching the data.ts interface shapes
- Handles loading and error states

## Phase 4: Update page.tsx

Replace:
```ts
import { AIRCRAFT, REPORTS, USER, RELAY, sampleTrack } from '@/lib/data'
```
With:
```ts
import { useRealtimeData, sampleTrack } from '@/hooks/useRealtimeData'
```

Use the hook's returned data instead of static imports everywhere.

## Phase 5: Connect Filter Panel

The filter logic in `page.tsx` already uses `filters` state to filter aircraft/reports — it just needs to operate on live data now instead of static AIRCRAFT/REPORTS. No changes needed to `filter-panel.tsx`.

The OpenSky API poll runs server-side so we don't expose API keys client-side. The Waze relay script runs on a home connection and POSTs to this server.
