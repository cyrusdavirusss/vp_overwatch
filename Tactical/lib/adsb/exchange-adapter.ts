/**
 * ADS-B Exchange Adapter (v2 gateway)
 * ────────────────────────────────────────────────────────────────────────────
 * Server-side, sole provider interface. ADS-B Exchange is the exclusive data
 * source; there is no fallback to any other aviation provider and the browser
 * never talks to the provider directly.
 *
 * Contract (per ADS-B Exchange v2 Enterprise gateway):
 *   Base URL : https://gateway.adsbexchange.com/api/aircraft/v2
 *   Auth     : X-Api-Key: <key>          (NOT Authorization: Bearer)
 *   Encoding : Accept-Encoding: gzip
 *   Registration → hex : GET /registration/{registration}
 *   Fetch by hex       : GET /icao/{csv}   or   POST /icao  { icaos: [...] }
 *   Response           : { ac: [ { hex, r, flight, alt_baro, alt_geom, gs,
 *                                  track, baro_rate, lat, lon, seen_pos, seen,
 *                                  squawk, emergency, ... } ], now, ... }
 *
 * Design rules enforced here:
 *   • Absent telemetry is `null`, never 0/""/false (no false on-ground/stopped).
 *   • `alt_baro: "ground"` is modelled explicitly via `onGround`, not as 0 ft.
 *   • `seen_pos` / `seen` are DURATIONS in seconds; stored as-is (the caller
 *     derives lastObservedAt from providerNow − seen_pos, never Date.now()).
 *   • Provider/transport failure updates health only; it must never be turned
 *     into takeoff / landing / telemetry_not_seen events by the caller.
 */

const DEFAULT_BASE_URL = 'https://gateway.adsbexchange.com/api/aircraft/v2'

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Normalized aircraft record. Field NAMES are preserved from the prior version
 * for compatibility with the state manager; the SEMANTICS are corrected
 * (nullable telemetry, explicit ground flag, durations left untouched).
 */
export interface ADSBAircraft {
  icao24: string                 // provider `hex`
  registration: string | null    // provider `r`
  callsign: string | null        // provider `flight` (trimmed)
  latitude: number | null
  longitude: number | null
  onGround: boolean              // provider alt_baro === "ground"
  altitudeBaro: number | null    // feet, or null (null when onGround/unknown)
  altitudeGeo: number | null     // feet
  groundSpeed: number | null     // knots
  track: number | null           // degrees
  verticalRate: number | null    // feet/min (baro_rate)
  seenPos: number | null         // seconds since last POSITION update (duration)
  seen: number | null            // seconds since last message (duration)
  squawk: string | null
  emergency: string | null       // provider `emergency` (e.g. "none")
  provider: string
}

export interface RegistrationLookup {
  registration: string           // normalized (upper, trimmed)
  icao24: string                 // '' when unresolved
  verified: boolean              // true only on exact case-normalized `r` match
  resolvedAt: Date
  source: string                 // 'adsb_exchange'
  status: 'verified' | 'unresolved'
}

export type ProviderErrorClass =
  | 'authentication_failure'   // 401/403
  | 'payment_required'         // 402
  | 'rate_limit'               // 429
  | 'provider_outage'          // >=500
  | 'client_error'             // other 4xx
  | 'connection_error'         // network/timeout
  | 'circuit_open'
  | 'unknown_error'

export interface ProviderHealth {
  status: 'live' | 'degraded' | 'unavailable'
  lastSuccessfulIngestion: Date | null
  errorClass: ProviderErrorClass | null
  errorMessage: string | null
  responseTimeMs: number
  circuitOpen: boolean
  consecutiveFailures: number
}

export interface CollectionResult {
  aircraft: Map<string, ADSBAircraft>  // keyed by icao24 (hex)
  providerNow: number | null           // provider `now` (unix ms), when present
}

export class ProviderError extends Error {
  readonly errorClass: ProviderErrorClass
  readonly status?: number
  constructor(message: string, errorClass: ProviderErrorClass, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.errorClass = errorClass
    this.status = status
  }
}

// ── Pure parsing helpers (exported for tests; no network) ───────────────────

/** Parse a numeric field: absent/invalid → null (never 0). */
export function parseNumeric(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalize one raw provider aircraft record into an ADSBAircraft.
 * Pure and side-effect free.
 */
export function normalizeAircraft(raw: any): ADSBAircraft {
  const onGround = raw?.alt_baro === 'ground'
  // Numeric baro altitude only when it's an actual number; "ground" and unknown
  // both leave altitudeBaro null and are distinguished by `onGround`.
  const altitudeBaro = onGround ? null : parseNumeric(raw?.alt_baro)

  const flight = typeof raw?.flight === 'string' ? raw.flight.trim() : ''
  const r = typeof raw?.r === 'string' ? raw.r.trim() : ''

  return {
    icao24: (raw?.hex ?? '').toString().trim().toLowerCase(),
    registration: r ? r.toUpperCase() : null,
    callsign: flight || null,
    latitude: parseNumeric(raw?.lat),
    longitude: parseNumeric(raw?.lon),
    onGround,
    altitudeBaro,
    altitudeGeo: parseNumeric(raw?.alt_geom),
    groundSpeed: parseNumeric(raw?.gs),
    track: parseNumeric(raw?.track),
    verticalRate: parseNumeric(raw?.baro_rate),
    seenPos: parseNumeric(raw?.seen_pos),
    seen: parseNumeric(raw?.seen),
    squawk: raw?.squawk != null ? String(raw.squawk) : null,
    emergency: raw?.emergency != null ? String(raw.emergency) : null,
    provider: 'adsb_exchange',
  }
}

/**
 * Parse a v2 gateway collection response body. Reads the provider's `ac`
 * array (NOT a top-level `aircraft`), keyed by hex. Tolerates a bare array.
 * Pure and side-effect free.
 */
export function parseCollection(body: any): CollectionResult {
  const list: any[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.ac)
      ? body.ac
      : []

  const aircraft = new Map<string, ADSBAircraft>()
  for (const raw of list) {
    const norm = normalizeAircraft(raw)
    if (norm.icao24) aircraft.set(norm.icao24, norm)
  }

  // `now` is provider time in ms; some deployments send seconds — normalize to ms.
  let providerNow = parseNumeric(body?.now)
  if (providerNow !== null && providerNow < 1e12) providerNow = providerNow * 1000

  return { aircraft, providerNow }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

interface AdapterOptions {
  baseUrl?: string
  maxRetries?: number
  requestTimeoutMs?: number
  circuitThreshold?: number      // consecutive failures before opening
  circuitCooldownMs?: number     // how long the breaker stays open
  now?: () => number             // injectable clock for tests
  fetchImpl?: typeof fetch       // injectable fetch for tests
}

export class ADSBExchangeAdapter {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number
  private readonly circuitThreshold: number
  private readonly circuitCooldownMs: number
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch

  private consecutiveFailures = 0
  private circuitOpenedAt: number | null = null
  private health: ProviderHealth = {
    status: 'unavailable',
    lastSuccessfulIngestion: null,
    errorClass: null,
    errorMessage: null,
    responseTimeMs: 0,
    circuitOpen: false,
    consecutiveFailures: 0,
  }

  constructor(apiKey: string, options: AdapterOptions = {}) {
    if (!apiKey) throw new Error('ADSBExchangeAdapter requires an API key')
    this.apiKey = apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.maxRetries = options.maxRetries ?? 3
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12_000
    this.circuitThreshold = options.circuitThreshold ?? 5
    this.circuitCooldownMs = options.circuitCooldownMs ?? 30_000
    this.now = options.now ?? Date.now
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  getHealth(): ProviderHealth {
    return { ...this.health, circuitOpen: this.isCircuitOpen(), consecutiveFailures: this.consecutiveFailures }
  }

  getConfiguration(): { baseUrl: string; provider: string; streamingEnabled: boolean } {
    return {
      baseUrl: this.baseUrl,
      provider: 'adsb_exchange',
      streamingEnabled: process.env.ADSB_INGESTION_MODE === 'streaming',
    }
  }

  /** Pure: true iff the breaker is currently open. No side effects (safe to
   *  call from getHealth). The half-open transition happens in request(). */
  private isCircuitOpen(): boolean {
    if (this.circuitOpenedAt === null) return false
    return this.now() - this.circuitOpenedAt < this.circuitCooldownMs
  }

  private classify(status: number): ProviderErrorClass {
    if (status === 401 || status === 403) return 'authentication_failure'
    if (status === 402) return 'payment_required'
    if (status === 429) return 'rate_limit'
    if (status >= 500) return 'provider_outage'
    if (status >= 400) return 'client_error'
    return 'unknown_error'
  }

  private recordSuccess(responseTimeMs: number): void {
    this.consecutiveFailures = 0
    this.circuitOpenedAt = null
    this.health = {
      status: 'live',
      lastSuccessfulIngestion: new Date(this.now()),
      errorClass: null,
      errorMessage: null,
      responseTimeMs,
      circuitOpen: false,
      consecutiveFailures: 0,
    }
  }

  private recordFailure(errorClass: ProviderErrorClass, message: string, responseTimeMs: number): void {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.circuitThreshold && this.circuitOpenedAt === null) {
      this.circuitOpenedAt = this.now()
    }
    this.health = {
      status: this.consecutiveFailures >= this.circuitThreshold ? 'unavailable' : 'degraded',
      lastSuccessfulIngestion: this.health.lastSuccessfulIngestion,
      errorClass,
      errorMessage: message,
      responseTimeMs,
      circuitOpen: this.circuitOpenedAt !== null,
      consecutiveFailures: this.consecutiveFailures,
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Core request with timeout, retry (exp backoff + jitter), 429 Retry-After
   * handling, 402/403 visibility, and a bounded circuit breaker. Returns the
   * parsed JSON body. Throws ProviderError on give-up.
   */
  private async request(path: string, init?: { method?: string; body?: unknown }): Promise<any> {
    // Half-open transition: once cooldown elapses, let ONE real request probe.
    if (this.circuitOpenedAt !== null && this.now() - this.circuitOpenedAt >= this.circuitCooldownMs) {
      this.circuitOpenedAt = null
    }
    if (this.isCircuitOpen()) {
      throw new ProviderError('Circuit breaker open', 'circuit_open')
    }

    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'X-Api-Key': this.apiKey,
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
    }
    let body: string | undefined
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }

    let lastErr: ProviderError | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const started = this.now()
      try {
        const res = await this.fetchImpl(url, {
          method: init?.method ?? 'GET',
          headers,
          body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        })
        const elapsed = this.now() - started

        if (res.ok) {
          const json = await res.json()
          this.recordSuccess(elapsed)
          return json
        }

        const errorClass = this.classify(res.status)
        const err = new ProviderError(`HTTP ${res.status} ${res.statusText}`, errorClass, res.status)
        lastErr = err
        this.recordFailure(errorClass, err.message, elapsed)

        // Auth / payment errors are not going to fix themselves via retry.
        if (errorClass === 'authentication_failure' || errorClass === 'payment_required' || errorClass === 'client_error') {
          throw err
        }

        // Honour Retry-After on 429 when present.
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after'))
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            await this.sleep(Math.min(retryAfter * 1000, 15_000))
            continue
          }
        }
      } catch (e) {
        const elapsed = this.now() - started
        if (e instanceof ProviderError) {
          if (e.errorClass === 'authentication_failure' || e.errorClass === 'payment_required' || e.errorClass === 'client_error') {
            throw e
          }
          lastErr = e
        } else {
          const msg = e instanceof Error ? e.message : 'connection error'
          lastErr = new ProviderError(msg, 'connection_error')
          this.recordFailure('connection_error', msg, elapsed)
        }
      }

      // Backoff before the next attempt (exponential + full jitter).
      if (attempt < this.maxRetries) {
        const base = Math.min(500 * 2 ** attempt, 8_000)
        await this.sleep(Math.floor(Math.random() * base))
      }
    }

    throw lastErr ?? new ProviderError('Request failed', 'unknown_error')
  }

  /**
   * Resolve a registration to a verified ICAO24 hex via GET /registration/{reg}.
   * Accepts the mapping ONLY when the returned `r` exactly matches the requested
   * registration after case normalization; otherwise status is 'unresolved' and
   * icao24 is ''. Never guesses a hex.
   */
  async resolveRegistration(registration: string): Promise<RegistrationLookup> {
    const normalizedReg = registration.trim().toUpperCase()
    const base: RegistrationLookup = {
      registration: normalizedReg,
      icao24: '',
      verified: false,
      resolvedAt: new Date(this.now()),
      source: 'adsb_exchange',
      status: 'unresolved',
    }

    const body = await this.request(`/registration/${encodeURIComponent(normalizedReg)}`)
    const { aircraft } = parseCollection(body)
    for (const ac of aircraft.values()) {
      if (ac.registration && ac.registration.toUpperCase() === normalizedReg && ac.icao24) {
        return { ...base, icao24: ac.icao24, verified: true, status: 'verified' }
      }
    }
    return base
  }

  /** Fetch tracked aircraft by hex via GET /icao/{csv}. One batched call. */
  async fetchByIcaos(icao24Ids: string[]): Promise<CollectionResult> {
    const ids = icao24Ids.map((h) => h.trim().toLowerCase()).filter(Boolean)
    if (ids.length === 0) return { aircraft: new Map(), providerNow: null }
    const csv = ids.join(',')
    const body = await this.request(`/icao/${encodeURIComponent(csv)}`)
    return parseCollection(body)
  }

  /** Fetch tracked aircraft by hex via POST /icao (list-body form). */
  async fetchByIcaosPost(icao24Ids: string[]): Promise<CollectionResult> {
    const ids = icao24Ids.map((h) => h.trim().toLowerCase()).filter(Boolean)
    if (ids.length === 0) return { aircraft: new Map(), providerNow: null }
    const body = await this.request('/icao', { method: 'POST', body: { icaos: ids } })
    return parseCollection(body)
  }
}
