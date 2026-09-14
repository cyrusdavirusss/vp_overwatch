# VP-Overwatch — self-host in 3 steps (Docker)

Requires Docker + Docker Compose. Brings up the whole stack:
web UI (`:3100`), Postgres, the ADS-B ingest worker, and the Waze POLICE relay.

```bash
git clone https://github.com/cyrusdavirusss/vp_overwatch.git
cd vp_overwatch
cp .env.example .env      # then edit .env — set the secrets + API keys
docker compose up -d --build
```

Open http://localhost:3100

## What you must put in `.env`
- `POSTGRES_PASSWORD`, `WAZE_RELAY_SECRET`, `GPS_RELAY_SECRET`, `AUTH_SECRET` — any long random strings (relay secret is shared by the app + relay automatically).
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` — free OpenSky account (ADS-B aircraft).
- `OPENWEBNINJA_API_KEY` — Waze police alerts (being replaced by a free API).

## Map basemap
Leave `NEXT_PUBLIC_PMTILES_URL` blank to use the hosted Protomaps basemap (works
immediately). For an offline Victoria basemap, drop `Tactical/public/victoria.pmtiles`
and set `NEXT_PUBLIC_PMTILES_URL=/victoria.pmtiles`, then rebuild.

## Manage
```bash
docker compose logs -f web ingest relay   # tail logs
docker compose ps                         # status
docker compose down                       # stop (keeps DB volume)
docker compose up -d --build              # apply code/.env changes
```

## Notes
- `NEXT_PUBLIC_*` values are baked at build time — change them in `.env` then re-run `up -d --build`.
- Data persists in the `vp_pg_data` volume across restarts.
- The covert Waze scraper tools are intentionally not shipped here.
