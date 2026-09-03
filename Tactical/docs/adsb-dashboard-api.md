# ADS-B Exchange Dashboard API

## Overview

Live aircraft tracking dashboard integrated with VP-Overwatch Tactical Operations Center.
Uses ADS-B Exchange as the exclusive provider with durable PostgreSQL persistence and
cache-backed API endpoints.

## Architecture

### Two-Rate Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         ADS-B Exchange                          │
│                    (Exclusive Provider)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Provider Calls (Ingestion Rate)
                             │ • Batch REST queries every 30-60s
                             │ • Streaming platform (optional)
                             │ • Registration lookups
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Ingestion Worker                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • Periodic batch queries (REST mode)                    │   │
│  │ • Streaming data processing (if enabled)                │   │
│  │ • ICAO24 registration resolution                        │   │
│  │ • State normalization & validation                      │   │
│  │ • Event detection (takeoff, landing, etc.)              │   │
│  │ • PostgreSQL persistence                                │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ State Updates (Persistence Layer)
                             │ • PostgreSQL (source of truth)
                             │ • Redis cache (optional)
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Dashboard Store (Singleton)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • Survives hot reloads & container restarts             │   │
│  │ • Loads from PostgreSQL on startup                      │   │
│  │ • Manages normalized aircraft state                     │   │
│  │ • Provides cache-backed snapshots                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Cache-Backed Queries (Dashboard Rate)
                             │ • No provider calls triggered
                             │ • Sub-second response times
                             │ • 30s cache TTL
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Endpoints                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ GET  /api/dashboard/health           - Health status    │   │
│  │ GET  /api/dashboard/aircraft         - All aircraft     │   │
│  │ GET  /api/dashboard/aircraft/[reg]   - Specific aircraft│   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Separation of Concerns**: Ingestion worker handles provider calls; dashboard endpoints serve cached state
2. **Durable State**: PostgreSQL provides source of truth across instances and restarts
3. **Cache-Backed Responses**: All dashboard endpoints return cached data without triggering provider calls
4. **Singleton Pattern**: Dashboard store survives hot reloads and maintains consistent state
5. **Provider Agnostic**: Adapter pattern enables future provider integration

---

## Environment Variables

Add to `.env.local`:

```bash
# ADS-B Exchange Configuration
ADSB_EXCHANGE_API_KEY=your_api_key_here
ADSB_STREAMING_ENABLED=true

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/vp_overwatch
DASHBOARD_DATABASE_URL=postgresql://user:password@localhost:5432/vp_overwatch

# Application
NODE_ENV=production
```

---

## API Endpoints

### 1. Dashboard Health

**GET** `/api/dashboard/health`

Returns dashboard health and provider connectivity status.

**Authentication:** Not required

**Response Example:**
```json
{
  "status": "healthy",
  "provider": {
    "name": "ADS-B Exchange",
    "status": "live",
    "latencySeconds": 45,
    "lastUpdate": "2026-09-02T14:30:00.000Z",
    "ingestionMode": "batch",
    "lastIngestionAt": "2026-09-02T14:29:30.000Z"
  },
  "dashboard": {
    "trackedAircraftCount": 4,
    "trackedRegistrations": ["VH-PVO", "VH-PVP", "VH-PVQ", "VH-PVE"],
    "lastStateUpdate": "2026-09-02T14:30:00.000Z"
  },
  "configuration": {
    "baseUrl": "https://adsbexchange.com/api",
    "streamingEnabled": true
  },
  "timestamp": "2026-09-02T14:30:00.000Z"
}
```

**Response Headers:**
- `X-Provider-Status`: live | stale | unavailable
- `X-Source-Latency-Sec`: Number of seconds

---

### 2. All Aircraft State

**GET** `/api/dashboard/aircraft`

Returns current state of all tracked aircraft.

**Authentication:** Required in production (provide `x-api-key` header)

**Response Example:**
```json
{
  "aircraft": [
    {
      "registration": "VH-PVO",
      "description": "Leonardo AW139 helicopter",
      "state": "live_airborne",
      "lastObservedAt": "2026-09-02T14:30:00.000Z",
      "positionFreshnessSeconds": 45,
      "latitude": -37.8136,
      "longitude": 144.9631,
      "altitudeMetres": 1524,
      "groundSpeedKt": 135,
      "trackDegrees": 270,
      "isPositionUsable": true,
      "dataStatus": "live",
      "eventVersion": 1247
    }
  ],
  "lastUpdate": "2026-09-02T14:30:00.000Z",
  "sourceLatencySeconds": 45,
  "providerStatus": "live",
  "ingestionMode": "batch",
  "lastIngestionAt": "2026-09-02T14:29:30.000Z"
}
```

**Response Headers:**
- `X-Provider-Status`: live | stale | unavailable
- `X-Source-Latency-Sec`: Number of seconds
- `X-Aircraft-Count`: Number of aircraft

**Cache-Control:** `public, s-maxage=30, stale-while-revalidate=60`

---

### 3. Specific Aircraft Details

**GET** `/api/dashboard/aircraft/[registration]`

Returns detailed state for a specific aircraft.

**Authentication:** Required in production (provide `x-api-key` header)

**Example:** `/api/dashboard/aircraft/VH-PVO`

**Response Example:**
```json
{
  "registration": "VH-PVO",
  "description": "Leonardo AW139 helicopter",
  "icao24": "7C4EF2",
  "state": "live_airborne",
  "lastObservedAt": "2026-09-02T14:30:00.000Z",
  "positionFreshnessSeconds": 45,
  "latitude": -37.8136,
  "longitude": 144.9631,
  "altitudeMetres": 1524,
  "groundSpeedKt": 135,
  "trackDegrees": 270,
  "isPositionUsable": true,
  "dataStatus": "live",
  "seenPos": 45,
  "seen": 42,
  "eventVersion": 1247,
  "icao24Mapping": {
    "verified": true,
    "resolvedAt": "2026-09-02T08:00:00.000Z",
    "lastVerifiedAt": "2026-09-02T14:00:00.000Z"
  }
}
```

**Response Headers:**
- `X-State`: Aircraft state value
- `X-Data-Status`: live | stale | unavailable

**Status Codes:**
- `200`: Success
- `401`: Authentication required
- `404`: Aircraft registration not found
- `503`: Service unavailable

---

### 4. Ingestion Worker (Internal)

The ingestion worker is not exposed as a browser-accessible endpoint. It runs as a background service:

- **Batch Mode**: Queries ADS-B Exchange every 30-60 seconds
- **Streaming Mode**: Real-time data processing (if streaming platform enabled)
- **State Updates**: Persists normalized state to PostgreSQL
- **Event Detection**: Generates events for state changes

---

## Aircraft States

| State | Description |
|-------|-------------|
| `unresolved` | ICAO24 registration mapping not yet resolved |
| `live_airborne` | Actively flying with valid position data (<60s freshness) |
| `live_ground` | On ground or taxiing with valid position data (<60s freshness) |
| `stale` | Position data 60-300 seconds old |
| `unavailable` | Position data >300 seconds old or no data |

## Data Status

| Status | Description |
|--------|-------------|
| `live` | Position data <60 seconds old |
| `stale` | Position data 60-300 seconds old |
| `unavailable` | Position data >300 seconds old or no data |

## Event Types

| Event | Trigger |
|-------|---------|
| `takeoff` | State transition: `live_ground` → `live_airborne` |
| `landing` | State transition: `live_airborne` → `live_ground` |
| `telemetry_not_seen` | State transition: `live_*` → `unavailable` |
| `reappeared` | State transition: `unavailable` → `live_*` |
| `proximity_enter` | Aircraft enters defined geographic area |

---

## Tracked Aircraft

| Registration | Description | ICAO24 Hex |
|--------------|-------------|------------|
| VH-PVO | Leonardo AW139 helicopter | Resolved at startup |
| VH-PVP | Leonardo AW139 helicopter | Resolved at startup |
| VH-PVQ | Leonardo AW139 helicopter | Resolved at startup |
| VH-PVE | Beechcraft 350i Super King Air | Resolved at startup |

---

## Security

### Authentication

All dashboard endpoints support API key authentication via the `x-api-key` header.

**Production Mode:** Authentication is required for all endpoints except `/api/dashboard/health`.

**Development Mode:** Authentication is optional.

### CORS

Configure CORS settings in your Next.js application to allow requests from your frontend origin.

### Secret Management

- API keys are stored in environment variables
- No credentials are exposed in API responses
- Database credentials use connection string environment variable
- Sensitive data is logged without exposing secrets

---

## Frontend Integration

### Basic Polling Example

```typescript
// Poll cached state every 30 seconds
const pollDashboard = async () => {
  const response = await fetch('/api/dashboard/aircraft', {
    headers: {
      'x-api-key': process.env.NEXT_PUBLIC_API_KEY
    }
  })
  
  const data = await response.json()
  
  // Check provider status
  const providerStatus = response.headers.get('X-Provider-Status')
  if (providerStatus === 'stale') {
    // Optionally notify or trigger refresh via ingestion worker
    console.log('Provider data is stale, consider triggering refresh')
  }
  
  return data
}

// Set up polling
setInterval(pollDashboard, 30000)
```

### Health Check Integration

```typescript
// Check dashboard health
const checkHealth = async () => {
  const response = await fetch('/api/dashboard/health')
  const health = await response.json()
  
  if (health.status === 'healthy' && health.provider.status === 'live') {
    // Dashboard is operational
    return true
  } else {
    // Dashboard or provider has issues
    console.warn('Dashboard health check:', health)
    return false
  }
}
```

---

## Production Deployment

### Prerequisites

1. **PostgreSQL Database**
   - Version 14+ recommended
   - Connection pool size: 10 connections
   - Schema initialized on startup

2. **ADS-B Exchange Account**
   - API key configured
   - Streaming platform entitlement (optional)

3. **Environment Configuration**
   - All required environment variables set
   - Production mode enabled

### Startup Sequence

1. Initialize database connection pool
2. Ensure database schema
3. Load existing state from PostgreSQL
4. Initialize ADS-B Exchange adapter
5. Resolve ICAO24 mappings for all tracked aircraft
6. Start ingestion worker (background service)
7. Dashboard endpoints ready for requests

### Monitoring

- Health endpoint for service checks
- Provider status via response headers
- Source latency metrics
- Event logging for state changes

---

## Implementation Details

### File Structure

```
lib/adsb/
├── exchange-adapter.ts          # ADS-B Exchange integration
├── dashboard-state-manager.ts   # State management & classification
├── dashboard-store.ts           # Singleton store with persistence
├── dashboard-init.ts            # Initialization configuration
├── persistence/
│   └── dashboard-persistence.ts # PostgreSQL persistence layer
└── types/                       # TypeScript type definitions

app/api/dashboard/
├── health/route.ts              # Health check endpoint
├── aircraft/route.ts            # All aircraft endpoint
└── aircraft/[registration]/route.ts  # Specific aircraft endpoint
```

---

**Last Updated:** September 2026  
**Provider:** ADS-B Exchange  
**Integration:** VP-Overwatch Tactical Operations Center