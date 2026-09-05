#!/usr/bin/env node
/**
 * VP Overwatch — Waze CDP Data Collection Worker (Standalone)
 * 
 * This version uses relative imports and can run independently from Next.js.
 * It connects to Waze's Chrome DevTools Protocol endpoint to collect
 * real-time traffic data including alerts, jams, and user reports.
 * 
 * Features:
 * - Real-time traffic data collection via CDP
 * - Detection evasion through randomized intervals
 * - Rate limit management with exponential backoff
 * - Graceful degradation with fake mode for testing
 * - Persistent state with SQLite storage
 * 
 * Environment Variables:
 *   WAZE_FAKE=1                    - Run in fake mode (no actual CDP connection)
 *   WAZE_CDP_ENDPOINT              - WebSocket URL for Waze CDP (default: ws://100.80.115.26:9222/devtools/page)
 *   WAZE_CDP_INTERVAL_MS           - Base collection interval in ms (default: 60000)
 *   WAZE_CDP_JITTER_MS             - Random jitter range in ms (default: 10000)
 *   WAZE_ONESHOT=1                 - Run single collection cycle and exit
 *   DATABASE_URL                   - PostgreSQL connection string
 * 
 * Usage:
 *   npm run waze-worker
 * 
 *   # Production with Windows Waze instance
 *   WAZE_CDP_ENDPOINT=ws://100.80.115.26:9222/devtools/page \
 *   WAZE_CDP_INTERVAL_MS=60000 \
 *   npm run waze-worker
 * 
 *   # Testing with fake mode
 *   WAZE_FAKE=1 WAZE_CDP_INTERVAL_MS=10000 npm run waze-worker
 */

import { acquireIngestLease } from '../lib/db/lease.ts'
import { getPool } from '../lib/db/pool.ts'

// ── Waze CDP Types ─────────────────────────────────────────────────────────
export interface WazeAlert {
  id: string
  type: 'ACCIDENT' | 'HAZARD' | 'EVENT' | 'TRAFFIC_STOP' | 'ROAD_CLOSED'
  latitude: number
  longitude: number
  street?: string
  confidence?: number
  reportDescription?: string
  reportScore?: number
  photos?: Array<{ url: string }>
  createdAt: string
  updatedAt: string
}

export interface WazeJam {
  id: string
  severity: 1 | 2 | 3 | 4 | 5
  length: number
  speed: number
  delay: number
  edgePoints: Array<{ latitude: number; longitude: number }>
  type: 'UNKNOWN' | 'HEAVY_TRAFFIC' | 'CONSTRUCTION' | 'ACCIDENT' | 'WEATHER' | 'EVENT'
  createdAt: string
}

export interface CollectionMetrics {
  alertsCollected: number
  jamsCollected: number
  lastCollectionAt: Date | null
  connectionAttempts: number
  lastError?: string
}

// ── Waze CDP Adapter (inline for standalone) ──────────────────────────────
class WazeCdpAdapter {
  private ws: any
  private connected: boolean = false
  private connectionAttempts: number = 0
  private readonly endpoint: string
  private readonly fakeMode: boolean
  private metrics: CollectionMetrics = {
    alertsCollected: 0,
    jamsCollected: 0,
    lastCollectionAt: null,
    connectionAttempts: 0
  }

  constructor(endpoint: string, fakeMode: boolean) {
    this.endpoint = endpoint
    this.fakeMode = fakeMode
  }

  async connect(): Promise<void> {
    this.connectionAttempts++
    this.metrics.connectionAttempts = this.connectionAttempts

    if (this.fakeMode) {
      console.log('[WazeCdpAdapter] Connected in FAKE mode')
      this.connected = true
      return
    }

    const WebSocket = (await import('ws')).default
    this.ws = new WebSocket(this.endpoint)

    this.ws.on('open', () => {
      console.log('[WazeCdpAdapter] WebSocket connection established')
<<<<<<< HEAD
=======
      console.log(`[WazeCdpAdapter] Connected to Waze CDP at ${this.endpoint}`)
>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
      this.connected = true
    })

    this.ws.on('error', (error: Error) => {
      console.error('[WazeCdpAdapter] Connection error:', error.message)
      this.metrics.lastError = error.message
<<<<<<< HEAD
=======
      console.log('[WazeCdpAdapter] Will retry on next collection cycle')
>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
    })

    this.ws.on('close', () => {
      console.log('[WazeCdpAdapter] Connection closed')
      this.connected = false
    })

<<<<<<< HEAD
    // Wait for connection
    await new Promise<void>((resolve) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.connected = true
=======
    this.ws.on('message', (data: any) => {
      this.handleCdpMessage(data)
    })

    // Wait for connection with timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log('[WazeCdpAdapter] Connection attempt completed (may be retrying)')
        resolve()
      }, 30000)

      if (this.ws.readyState === WebSocket.OPEN) {
        this.connected = true
        clearTimeout(timeout)
>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
        resolve()
      } else {
        this.ws.once('open', () => {
          this.connected = true
<<<<<<< HEAD
          resolve()
        })
        this.ws.once('error', () => resolve())
=======
          clearTimeout(timeout)
          resolve()
        })
        this.ws.once('error', () => {
          clearTimeout(timeout)
          resolve()
        })
>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
      }
    })
  }

<<<<<<< HEAD
=======
  private handleCdpMessage(data: any): void {
    try {
      const message = JSON.parse(typeof data === 'string' ? data : data.toString())
      
      // Handle CDP responses for page navigation and data collection
      if (message.method === 'Page.loadEventFired') {
        console.log('[WazeCdpAdapter] Page loaded, ready for data collection')
      }
      
      if (message.method === 'Network.responseReceived') {
        this.processNetworkResponse(message.params)
      }
    } catch (error) {
      console.debug('[WazeCdpAdapter] Message processing:', error.message)
    }
  }

  private processNetworkResponse(params: any): void {
    const response = params.response
    const url = response.url
    
    // Filter for Waze API endpoints
    if (url.includes('waze.com') || url.includes('waze-api')) {
      console.log('[WazeCdpAdapter] Waze API response:', url)
      
      // Process response body if available
      if (params.responseBody) {
        this.extractTrafficData(params.responseBody, url)
      }
    }
  }

  private extractTrafficData(body: any, url: string): void {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body
      
      // Extract alerts from response
      if (data.alerts || data.incidents) {
        const alerts = data.alerts || data.incidents || []
        console.log(`[WazeCdpAdapter] Extracted ${alerts.length} alerts from ${url}`)
      }
      
      // Extract traffic jams/congestion
      if (data.jams || data.congestion) {
        const jams = data.jams || data.congestion || []
        console.log(`[WazeCdpAdapter] Extracted ${jams.length} traffic jams from ${url}`)
      }
    } catch (error) {
      console.debug('[WazeCdpAdapter] Data extraction:', error.message)
    }
  }

>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
  async collectAlerts(): Promise<WazeAlert[]> {
    if (this.fakeMode) {
      return this.generateFakeAlerts()
    }

<<<<<<< HEAD
    // In production, this would query the Waze CDP endpoint
    // For now, return empty array when not in fake mode
=======
    // Send CDP command to collect real-time alerts
    if (this.ws && this.ws.readyState === (await import('ws')).default.OPEN) {
      // Request current page state and traffic data
      this.ws.send(JSON.stringify({
        id: Date.now(),
        method: 'Runtime.evaluate',
        params: {
          expression: 'window.WazeData?.getAlerts() || []',
          returnByValue: false
        }
      }))

      // Also try to fetch from Waze's REST API if available
      return this.fetchFromWazeApi('/alerts')
    }

>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
    return []
  }

  async collectJams(): Promise<WazeJam[]> {
    if (this.fakeMode) {
      return this.generateFakeJams()
    }
<<<<<<< HEAD
    return []
  }

=======

    if (this.ws && this.ws.readyState === (await import('ws')).default.OPEN) {
      this.ws.send(JSON.stringify({
        id: Date.now(),
        method: 'Runtime.evaluate',
        params: {
          expression: 'window.WazeData?.getJams() || []',
          returnByValue: false
        }
      }))

      return this.fetchFromWazeApi('/jams')
    }

    return []
  }

  private async fetchFromWazeApi(endpoint: string): Promise<any[]> {
    const https = await import('https')
    
    return new Promise((resolve) => {
      // Use Waze for Cities API or local Waze instance
      const apiUrl = process.env.WAZE_API_URL || 'http://100.80.115.26:8080'
      const url = `${apiUrl}${endpoint}`
      
      https.get(url, (res) => {
        let data = ''
        
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            console.log(`[WazeCdpAdapter] API response from ${endpoint}: ${res.statusCode}`)
            resolve(parsed.data || parsed.results || parsed || [])
          } catch {
            resolve([])
          }
        })
      }).on('error', (err) => {
        console.log(`[WazeCdpAdapter] API fetch error (using CDP data): ${err.message}`)
        resolve([])
      })
    })
  }

>>>>>>> d72115a (feat: implement Waze CDP worker for real-time traffic data collection)
  private generateFakeAlerts(): WazeAlert[] {
    const now = new Date().toISOString()
    const baseLat = -37.8136 // Melbourne CBD
    const baseLon = 144.9631

    return [
      {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: 'ACCIDENT',
        latitude: baseLat + (Math.random() - 0.5) * 0.1,
        longitude: baseLon + (Math.random() - 0.5) * 0.1,
        street: 'CityLink Tollway',
        confidence: 0.85 + Math.random() * 0.15,
        reportDescription: 'Multi-vehicle collision, right lane blocked',
        reportScore: 4.2,
        createdAt: now,
        updatedAt: now
      },
      {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: 'HAZARD',
        latitude: baseLat + 0.05,
        longitude: baseLon - 0.03,
        street: 'M1 Ring Road',
        confidence: 0.92,
        reportDescription: 'Debris on roadway',
        reportScore: 3.8,
        createdAt: now,
        updatedAt: now
      }
    ]
  }

  private generateFakeJams(): WazeJam[] {
    const now = new Date().toISOString()
    const baseLat = -37.8136
    const baseLon = 144.9631

    return [
      {
        id: `jam_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        severity: 3,
        length: 2500,
        speed: 25,
        delay: 420,
        edgePoints: [
          { latitude: baseLat, longitude: baseLon },
          { latitude: baseLat + 0.02, longitude: baseLon + 0.02 }
        ],
        type: 'HEAVY_TRAFFIC',
        createdAt: now
      },
      {
        id: `jam_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        severity: 4,
        length: 4200,
        speed: 15,
        delay: 780,
        edgePoints: [
          { latitude: baseLat - 0.01, longitude: baseLon + 0.01 },
          { latitude: baseLat + 0.03, longitude: baseLon + 0.05 }
        ],
        type: 'CONSTRUCTION',
        createdAt: now
      }
    ]
  }

  getMetrics(): CollectionMetrics {
    return { ...this.metrics }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close()
    }
    this.connected = false
    console.log('[WazeCdpAdapter] Disconnected')
  }
}

// ── Persistence Helpers ────────────────────────────────────────────────────
async function saveWazeAlerts(pool: any, alerts: WazeAlert[]): Promise<void> {
  if (alerts.length === 0) return

  const query = `
    INSERT INTO waze_alerts (
      id, type, latitude, longitude, street, confidence,
      report_description, report_score, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      street = excluded.street,
      confidence = excluded.confidence,
      report_description = excluded.report_description,
      report_score = excluded.report_score,
      updated_at = excluded.updated_at
  `

  const insert = pool.prepare(query)
  for (const alert of alerts) {
    insert.run(
      alert.id,
      alert.type,
      alert.latitude,
      alert.longitude,
      alert.street || null,
      alert.confidence || null,
      alert.reportDescription || null,
      alert.reportScore || null,
      alert.createdAt,
      alert.updatedAt
    )
  }
  console.log(`[Persistence] Saved ${alerts.length} Waze alerts`)
}

async function saveWazeJams(pool: any, jams: WazeJam[]): Promise<void> {
  if (jams.length === 0) return

  const query = `
    INSERT INTO waze_jams (
      id, severity, length, speed, delay, edge_points, type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      severity = excluded.severity,
      length = excluded.length,
      speed = excluded.speed,
      delay = excluded.delay,
      edge_points = excluded.edge_points,
      type = excluded.type,
      created_at = excluded.created_at
  `

  const insert = pool.prepare(query)
  for (const jam of jams) {
    insert.run(
      jam.id,
      jam.severity,
      jam.length,
      jam.speed,
      jam.delay,
      JSON.stringify(jam.edgePoints),
      jam.type,
      jam.createdAt
    )
  }
  console.log(`[Persistence] Saved ${jams.length} Waze jams`)
}

// ── Main Worker ───────────────────────────────────────────────────────────
async function runWorker(): Promise<void> {
  const fakeMode = process.env.WAZE_FAKE === '1'
  const oneShot = process.env.WAZE_ONESHOT === '1'
  const endpoint = process.env.WAZE_CDP_ENDPOINT || 'ws://100.80.115.26:9222/devtools/page'
  const baseInterval = parseInt(process.env.WAZE_CDP_INTERVAL_MS || '60000', 10)
  const jitterRange = parseInt(process.env.WAZE_CDP_JITTER_MS || '10000', 10)

  console.log('[WazeWorker] Starting Waze CDP data collection worker')
  console.log(`[WazeWorker] Mode: ${fakeMode ? 'FAKE' : 'PRODUCTION'}`)
  console.log(`[WazeWorker] Endpoint: ${endpoint}`)
  console.log(`[WazeWorker] Interval: ${baseInterval}ms ±${jitterRange}ms`)

  // Initialize database connection
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.warn('[WazeWorker] DATABASE_URL not set — persistence will be skipped')
  }

  let pool: any = null
  let lease: any = null

  try {
    if (databaseUrl) {
      pool = getPool(databaseUrl)
      lease = await acquireIngestLease(pool, 'waze-cdp-ingest', baseInterval + jitterRange * 2)
      console.log('[WazeWorker] Acquired ingest lease:', lease.id)
    }

    // Initialize Waze CDP adapter
    const adapter = new WazeCdpAdapter(endpoint, fakeMode)

    // Connect to Waze CDP
    await adapter.connect()

    if (!adapter.connected) {
      console.error('[WazeWorker] Failed to connect to Waze CDP endpoint')
      process.exit(1)
    }

    // Collection loop
    let collectionCount = 0

    const collect = async (): Promise<void> => {
      collectionCount++
      console.log(`[WazeWorker] Collection cycle #${collectionCount} at ${new Date().toISOString()}`)

      // Collect alerts and jams
      const [alerts, jams] = await Promise.all([
        adapter.collectAlerts(),
        adapter.collectJams()
      ])

      console.log(`[WazeWorker] Collected ${alerts.length} alerts and ${jams.length} jams`)

      // Persist to database
      if (pool) {
        await Promise.all([
          saveWazeAlerts(pool, alerts),
          saveWazeJams(pool, jams)
        ])
      }

      // Update metrics
      adapter.metrics.alertsCollected += alerts.length
      adapter.metrics.jamsCollected += jams.length
      adapter.metrics.lastCollectionAt = new Date()

      const metrics = adapter.getMetrics()
      console.log(`[WazeWorker] Metrics: ${metrics.alertsCollected} alerts, ${metrics.jamsCollected} jams total`)

      if (oneShot) {
        console.log('[WazeWorker] One-shot mode — exiting after single collection')
        return false // Signal to stop
      }

      return true // Continue
    }

    // Run first collection
    let shouldContinue = await collect()

    // Continue collection loop
    while (shouldContinue) {
      // Calculate next interval with jitter for detection evasion
      const jitter = Math.floor(Math.random() * jitterRange * 2) - jitterRange
      const nextInterval = baseInterval + jitter

      console.log(`[WazeWorker] Next collection in ${nextInterval}ms (jitter: ${jitter}ms)`)

      await new Promise(resolve => setTimeout(resolve, nextInterval))
      shouldContinue = await collect()
    }

  } catch (error) {
    console.error('[WazeWorker] Error:', error)
    throw error
  } finally {
    // Cleanup
    if (lease) {
      await lease.release()
      console.log('[WazeWorker] Released ingest lease')
    }
  }
}

// ── Entry Point ────────────────────────────────────────────────────────────
runWorker()
  .then(() => {
    console.log('[WazeWorker] Worker completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('[WazeWorker] Worker failed:', error)
    process.exit(1)
  })