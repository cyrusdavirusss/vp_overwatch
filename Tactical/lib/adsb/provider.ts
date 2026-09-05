/**
 * Aviation-data provider abstraction. The ingestion worker depends on this
 * interface, not a concrete adapter, so the source (ADS-B Exchange or OpenSky)
 * is a config choice. The browser never touches either.
 */
import { ADSBExchangeAdapter, type CollectionResult, type ProviderHealth, type RegistrationLookup } from './exchange-adapter.ts'
import { OpenSkyAdapter } from './opensky-adapter.ts'
import { adsbProvider, openSkyBbox } from './config.ts'

export interface AircraftProvider {
  fetchByIcaos(icaos: string[]): Promise<CollectionResult>
  resolveRegistration(registration: string): Promise<RegistrationLookup>
  getHealth(): ProviderHealth
  getConfiguration(): { baseUrl?: string; provider: string; streamingEnabled?: boolean }
}

/** Build the configured provider. Throws only if a required key is missing. */
export function createProvider(): AircraftProvider {
  if (adsbProvider() === 'opensky') {
    // Reads OAuth2 (OPENSKY_CLIENT_ID/SECRET) or basic (OPENSKY_USERNAME/PASSWORD)
    // from env; bbox defaults to Melbourne (config.openSkyBbox()).
    return new OpenSkyAdapter({ bbox: openSkyBbox() ?? undefined })
  }
  const key = process.env.ADSB_EXCHANGE_API_KEY
  if (!key) throw new Error('ADSB_EXCHANGE_API_KEY required for adsbexchange provider (or set ADSB_PROVIDER=opensky)')
  return new ADSBExchangeAdapter(key)
}
