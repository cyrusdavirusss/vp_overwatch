# Waze CDP Data Collection

Real-time traffic data collection from Waze via Chrome DevTools Protocol (CDP), integrated into VP Overwatch tactical operations center.

## Overview

The Waze CDP adapter collects live traffic alerts and road condition data by connecting to a Waze browser instance running on the Windows desktop (100.80.115.26:9222). It implements detection evasion, rate limiting, and circuit breaker resilience for reliable, continuous data ingestion.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Waze CDP Adapter                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   CDP Sessions   │  │  Rate Limiter    │  │ Circuit      │  │
│  │  (WebSocket)     │  │  (Token Bucket)  │  │  Breaker     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│         │                     │                        │        │
│         ▼                     ▼                        ▼        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Collection Loop                             │   │
│  │  • Bounding Box Grid (Melbourne Metro)                   │   │
│  │  • Fingerprint Rotation                                  │   │
│  │  • Alert & Jam Parsing                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│                   ┌────────────────────┐                        │
│                   │  VP Overwatch Store│                        │
│                   │  (Dashboard API)   │                        │
│                   └────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Waze CDP Adapter (`lib/waze-cdp/waze-cdp-adapter.ts`)

Core adapter providing:
- **CDP Connection Management**: WebSocket sessions to Chrome DevTools Protocol
- **Network Domain Interception**: Captures Waze API traffic (alerts, jams)
- **Rate Limiting**: Token bucket algorithm (30 RPS, 50 burst capacity)
- **Circuit Breaker**: Resilience pattern with failure threshold and recovery timeout
- **Fingerprint Rotation**: Browser identity rotation every 5 minutes
- **Bounding Box Grid**: 12.5km × 12.5km cells covering Melbourne metro (50km radius)

### 2. Ingestion Worker (`scripts/waze-cdp-ingest.ts`)

Standalone supervised process that:
- Holds Postgres advisory lease for single-writer coordination
- Runs collection loop at configurable intervals (default: 15 seconds)
- Publishes collected data to VP Overwatch store
- Records metrics to dashboard persistence layer
- Handles graceful shutdown with SIGINT/SIGTERM

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WAZE_CDP_ENDPOINT` | `ws://100.80.115.26:9222/devtools/page` | CDP WebSocket endpoint |
| `WAZE_CDP_INTERVAL_MS` | `15000` | Collection interval in milliseconds |
| `WAZE_RATE_LIMIT_RPS` | `30` | Rate limit requests per second |
| `WAZE_FINGERPRINT_ROTATION_MS` | `300000` | Fingerprint rotation interval (5 min) |
| `WAZE_FAKE` | `0` | Simulation mode (no network calls) |
| `WAZE_ONESHOT` | `0` | Run single collection cycle and exit |

### Bounding Box Configuration

Default Melbourne metro grid centered at `-37.8136, 144.9631` with 5×5 cell layout:

```typescript
{
  id: 'mel-0',
  name: 'Melbourne Grid A3',
  latMin: -37.8136 - 2 * 0.112,
  latMax: -37.8136 - 1 * 0.112,
  lngMin: 144.9631 - 2 * 0.112,
  lngMax: 144.9631 - 1 * 0.112,
  priority: 4
}
```

## Usage

### Start Waze CDP Worker

```bash
cd ~/Documents/vp_overwatch/Tactical

# Production mode
DATABASE_URL=postgresql://... \
WAZE_CDP_ENDPOINT=ws://100.80.115.26:9222/devtools/page \
npm run waze-worker

# Development with fake mode
WAZE_FAKE=1 WAZE_CDP_INTERVAL_MS=10000 npm run waze-worker

# Single collection cycle
WAZE_ONESHOT=1 npm run waze-worker
```

### Monitoring

The worker logs collection metrics including:
- Total/successful/failed requests
- Throttled requests count
- Circuit breaker state transitions
- Alerts and jams collected per cycle
- Bounding boxes covered

### Integration with Dashboard

Collected data is published to the VP Overwatch store via:
- `store.upsertAlert()` for traffic alerts
- `store.updateRelayAfterIngest()` for relay metadata
- Metrics recorded to `ingestion_runs` table for dashboard visibility

## Detection Evasion

### Fingerprint Rotation

Every 5 minutes, the adapter rotates browser fingerprints:
- User agent strings (Chrome 129-131 variants)
- Viewport dimensions (1920×1080, 1680×1050, 1440×900)
- Device scale factors (1x, 2x)
- Locale settings (en-AU, Australia/Melbourne timezone)

### Rate Limiting Strategy

- **Token Bucket**: 50 tokens burst capacity, 30 tokens/second refill
- **Sliding Window**: 60-second windows with adaptive throttling
- **Exponential Backoff**: Jittered retries on 429 responses
- **Per-Window Quota**: Maximum requests per minute enforced

### Geographic Grid Strategy

Large coverage areas are split into manageable bounding boxes:
- Each box: ~12.5km × 12.5km (0.112° latitude/longitude)
- Priority-based collection order (center-first expansion)
- Up to 200 alerts and 800 jams per box per request

## Circuit Breaker

| State | Condition | Behavior |
|-------|-----------|----------|
| Closed | Normal operation | All requests pass through |
| Open | ≥5 consecutive failures | Requests rejected, 30s cooldown |
| Half-Open | Cooldown elapsed | 3 probe requests allowed |

## Data Models

### WazeAlert

```typescript
interface WazeAlert extends Report {
  source: 'waze_cdp'
  cdpCollectedAt: number
  boundingBoxId: string
  fingerprintId: string
}
```

### WazeJam

```typescript
interface WazeJam {
  id: string
  cells: Array<{ x: number; y: number; speed: number; delay: number; length: number }>
  severity: 1 | 2 | 3 | 4 | 5
  length: number
  speed: number
  delay: number
  timestamp: number
  source: 'waze_cdp'
  cdpCollectedAt: number
  boundingBoxId: string
}
```

## Troubleshooting

### Connection Issues

1. **CDP Endpoint Unreachable**
   - Verify Waze browser is running on Windows desktop
   - Check Chrome DevTools port 9222 is accessible
   - Confirm Tailscale connectivity to 100.80.115.26

2. **Rate Limit Throttling**
   - Monitor `throttledRequests` metric
   - Adjust `WAZE_RATE_LIMIT_RPS` if consistently throttled
   - Check `Retry-After` headers in CDP responses

3. **Circuit Breaker Opens**
   - Review `failedRequests` count and error classes
   - Verify Waze API health and response times
   - Check network connectivity to Waze endpoints

### Performance Tuning

- **Collection Interval**: Reduce `WAZE_CDP_INTERVAL_MS` for more frequent updates
- **Bounding Box Size**: Adjust cell size for different coverage densities
- **Fingerprint Rotation**: Shorten rotation interval for higher evasion requirements

## Files

- `lib/waze-cdp/waze-cdp-adapter.ts` — Core CDP adapter implementation
- `scripts/waze-cdp-ingest.ts` — Ingestion worker process
- `app/api/waze/alerts/route.ts` — Dashboard alerts API endpoint
- `app/api/waze/ingest/route.ts` — Data ingestion endpoint
- `package.json` — Added `waze-worker` npm script

## Testing

```bash
# Run with fake mode (no external dependencies)
WAZE_FAKE=1 npm run waze-worker

# Single cycle for validation
WAZE_FAKE=1 WAZE_ONESHOT=1 npm run waze-worker

# Monitor with verbose logging
WAZE_FAKE=1 npm run waze-worker 2>&1 | grep -E '\[(waze-cdp-ingest|WazeCdpAdapter)\]'
```

## Future Enhancements

- Streaming mode for real-time CDP event processing
- Multi-session load distribution across CDP connections
- Historical data aggregation and trend analysis
- Integration with ADS-B aircraft tracking for correlated events
- Alert enrichment with community reports and visual sightings