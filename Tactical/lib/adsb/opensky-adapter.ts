/**
 * OpenSky Network adapter (server-side).
 * ────────────────────────────────────────────────────────────────────────────
 * A second aviation-data provider behind the same interface as the ADS-B
 * Exchange adapter, selectable via ADSB_PROVIDER=opensky. The browser never
 * calls it. OpenSky's non-commercial license fits VP Overwatch's public-safety
 * use; anonymous access needs no key (lower daily credit budget), OAuth2 client
 * credentials (OPENSKY_CLIENT_ID/SECRET) raise the budget.
 *
 * OpenSky `/states/all` returns state VECTORS (arrays), in SI units:
 *   [0]icao24 [1]callsign [3]time_position [4]last_contact [5]lon [6]lat
 *   [7]baro_alt(m) [8]on_ground [9]velocity(m/s) [10]true_track [11]vrate(m/s)
 *   [13]geo_alt(m) [14]squawk ... plus a top-level `time` (unix seconds).
 * We normalize into the SAME internal ADSBAircraft shape the pipeline uses
 * (feet + knots + fpm), and derive seen_pos as a DURATION = time − time_position.
 */
import {
  ProviderError, type ADSBAircraft, type CollectionResult, type ProviderHealth,
  type RegistrationLookup, type ProviderErrorClass,
} from './exchange-adapter.ts'
import type { Bbox } from './types.ts'

const STATES_URL = 'https://opensky-network.org/api/states/all'
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

const M_TO_FT = 3.280839895
const MS_TO_KT = 1.943844492
const MS_TO_FPM = 196.8503937

const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normalize one OpenSky state vector into an ADSBAircraft. Pure. */
export function normalizeState(s: any[], snapshotSec: number | null): ADSBAircraft {
  const timePos = numOrNull(s[3])
  const lastContact = numOrNull(s[4])
  const baroM = numOrNull(s[7])
  const geoM = numOrNull(s[13])
  const velMs = numOrNull(s[9])
  const vrateMs = numOrNull(s[11])
  const snap = snapshotSec
  const callsign = typeof s[1] === 'string' ? s[1].trim() : ''
  return {
    icao24: String(s[0] ?? '').trim().toLowerCase(),
    registration: null,                       // states/all carries no registration
    callsign: callsign || null,
    latitude: numOrNull(s[6]),
    longitude: numOrNull(s[5]),
    onGround: Boolean(s[8]),
    altitudeBaro: baroM === null ? null : baroM * M_TO_FT,
    altitudeGeo: geoM === null ? null : geoM * M_TO_FT,
    groundSpeed: velMs === null ? null : velMs * MS_TO_KT,
    track: numOrNull(s[10]),
    verticalRate: vrateMs === null ? null : vrateMs * MS_TO_FPM,
    seenPos: timePos === null || snap === null ? null : Math.max(0, snap - timePos),
    seen: lastContact === null || snap === null ? null : Math.max(0, snap - lastContact),
    squawk: s[14] != null ? String(s[14]) : null,
    emergency: null,
    provider: 'opensky',
  }
}

/** Parse a /states/all body into the shared CollectionResult. Pure. */
export function parseStates(body: any): CollectionResult {
  const snapshotSec = numOrNull(body?.time)
  const list: any[] = Array.isArray(body?.states) ? body.states : []
  const aircraft = new Map<string, ADSBAircraft>()
  for (const s of list) {
    if (!Array.isArray(s)) continue
    const norm = normalizeState(s, snapshotSec)
    if (norm.icao24) aircraft.set(norm.icao24, norm)
  }
  return { aircraft, providerNow: snapshotSec === null ? null : snapshotSec * 1000 }
}

interface OpenSkyOptions {
  clientId?: string
  clientSecret?: string
  username?: string      // basic-auth fallback (legacy OpenSky login)
  password?: string
  bbox?: Bbox            // when set, fetchByIcaos queries this box (cheaper) + filters
  maxRetries?: number
  requestTimeoutMs?: number
  now?: () => number
  fetchImpl?: typeof fetch
}

export class OpenSkyAdapter {
  private readonly clientId?: string
  private readonly clientSecret?: string
  private readonly username?: string
  private readonly password?: string
  private readonly bbox?: Bbox
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch
  private token: { value: string; expiresAt: number } | null = null
  private health: ProviderHealth = {
    status: 'unavailable', lastSuccessfulIngestion: null, errorClass: null,
    errorMessage: null, responseTimeMs: 0, circuitOpen: false, consecutiveFailures: 0,
  }

  constructor(options: OpenSkyOptions = {}) {
    this.clientId = options.clientId ?? process.env.OPENSKY_CLIENT_ID
    this.clientSecret = options.clientSecret ?? process.env.OPENSKY_CLIENT_SECRET
    this.username = options.username ?? process.env.OPENSKY_USERNAME
    this.password = options.password ?? process.env.OPENSKY_PASSWORD
    this.bbox = options.bbox
    this.maxRetries = options.maxRetries ?? 2
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12_000
    this.now = options.now ?? Date.now
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  getHealth(): ProviderHealth { return { ...this.health } }
  getConfiguration() {
    const authMode = (this.clientId && this.clientSecret) ? 'oauth2' : (this.username && this.password) ? 'basic' : 'anonymous'
    return { baseUrl: STATES_URL, provider: 'opensky', streamingEnabled: false, authenticated: authMode !== 'anonymous', authMode, bbox: this.bbox ?? null }
  }

  private classify(status: number): ProviderErrorClass {
    if (status === 401 || status === 403) return 'authentication_failure'
    if (status === 429) return 'rate_limit'
    if (status >= 500) return 'provider_outage'
    if (status >= 400) return 'client_error'
    return 'unknown_error'
  }

  /** Fetch an OAuth2 client-credentials token when creds are configured. */
  private async getToken(): Promise<string | null> {
    if (!this.clientId || !this.clientSecret) return null
    if (this.token && this.now() < this.token.expiresAt - 30_000) return this.token.value
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret })
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: AbortSignal.timeout(this.requestTimeoutMs),
    })
    if (!res.ok) throw new ProviderError(`OpenSky token ${res.status}`, this.classify(res.status), res.status)
    const j: any = await res.json()
    this.token = { value: j.access_token, expiresAt: this.now() + (Number(j.expires_in ?? 1800) * 1000) }
    return this.token.value
  }

  private async request(url: string): Promise<any> {
    let lastErr: ProviderError | null = null
    let tokenRefreshed = false
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const started = this.now()
      try {
        const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Encoding': 'gzip' }
        const token = await this.getToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
        else if (this.username && this.password) {
          headers['Authorization'] = 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64')
        }
        const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.requestTimeoutMs) })
        const elapsed = this.now() - started
        if (res.ok) {
          const j = await res.json()
          this.health = { status: 'live', lastSuccessfulIngestion: new Date(this.now()), errorClass: null, errorMessage: null, responseTimeMs: elapsed, circuitOpen: false, consecutiveFailures: 0 }
          return j
        }
        const cls = this.classify(res.status)
        lastErr = new ProviderError(`HTTP ${res.status} ${res.statusText}`, cls, res.status)
        this.health = { ...this.health, status: cls === 'rate_limit' ? 'degraded' : 'unavailable', errorClass: cls, errorMessage: lastErr.message, responseTimeMs: elapsed }
        // OAuth2: a 401 may just be an expired token — drop it and retry once
        // with a freshly minted token before treating it as an auth failure.
        if (res.status === 401 && this.clientId && this.clientSecret && this.token && !tokenRefreshed) {
          this.token = null
          tokenRefreshed = true
          continue
        }
        if (cls === 'authentication_failure' || cls === 'client_error') throw lastErr
      } catch (e) {
        if (e instanceof ProviderError && (e.errorClass === 'authentication_failure' || e.errorClass === 'client_error')) throw e
        lastErr = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : 'connection error', 'connection_error')
        this.health = { ...this.health, status: 'unavailable', errorClass: lastErr.errorClass, errorMessage: lastErr.message }
      }
      if (attempt < this.maxRetries) await new Promise((r) => setTimeout(r, Math.floor(Math.random() * Math.min(500 * 2 ** attempt, 4000))))
    }
    throw lastErr ?? new ProviderError('OpenSky request failed', 'unknown_error')
  }

  /** Fetch specific aircraft by ICAO24 hex (comma of repeated icao24 params). */
  async fetchByIcaos(icao24Ids: string[]): Promise<CollectionResult> {
    const ids = icao24Ids.map((h) => h.trim().toLowerCase()).filter(Boolean)
    if (ids.length === 0) return { aircraft: new Map(), providerNow: null }
    // Bounding-box mode: one small-area query (cheaper credits) then filter to
    // the tracked hexes. Aircraft outside the box are simply not returned.
    if (this.bbox) {
      const coll = await this.fetchByBbox(this.bbox.lamin, this.bbox.lomin, this.bbox.lamax, this.bbox.lomax)
      const filtered = new Map<string, ADSBAircraft>()
      for (const id of ids) {
        const a = coll.aircraft.get(id)
        if (a) filtered.set(id, a)
      }
      return { aircraft: filtered, providerNow: coll.providerNow }
    }
    const qs = ids.map((h) => `icao24=${encodeURIComponent(h)}`).join('&')
    return parseStates(await this.request(`${STATES_URL}?${qs}`))
  }

  /** Fetch all aircraft within a bounding box (used for area/demo queries). */
  async fetchByBbox(lamin: number, lomin: number, lamax: number, lomax: number): Promise<CollectionResult> {
    const qs = `lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`
    return parseStates(await this.request(`${STATES_URL}?${qs}`))
  }

  /**
   * OpenSky's live API is hex-keyed and does not resolve registration→hex, so
   * this always reports unresolved. Provide the four Mode-S hexes via config
   * overrides instead (see config.hexOverride).
   */
  async resolveRegistration(registration: string): Promise<RegistrationLookup> {
    return { registration: registration.trim().toUpperCase(), icao24: '', verified: false, resolvedAt: new Date(this.now()), source: 'opensky', status: 'unresolved' }
  }
}
