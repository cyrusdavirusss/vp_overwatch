// PM2 process definitions for VP-Overwatch.
//
// Two SEPARATE processes:
//   1. vp-overwatch        — the Next.js standalone web/API server (read-only:
//                            serves cached state, never calls ADS-B Exchange).
//   2. vp-overwatch-ingest — the ADS-B ingestion WORKER (the ONLY component that
//                            calls ADS-B Exchange). Holds a Postgres advisory
//                            lease so exactly one ingester runs across replicas.
//
// systemd is the active supervisor in this deployment (vp-overwatch.service +
// vp-overwatch-ingest.service). Use PM2 only if you switch supervisors; the web
// and worker must not double-run under both.
//
// Build is `npm run build` (next build + copy-standalone + sync-dist). NEVER a
// bare `next build` — that desyncs the running standalone server (500 chunks /
// blank page). PM2 does not build; build first.
//
// Port 3000 is taken by the Hermes bridge, so the web app uses 3100.

module.exports = {
  apps: [
    {
      name: 'vp-overwatch',
      cwd: '/home/cyrus/Documents/vp_overwatch/Tactical',
      script: '.next/standalone/server.js',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: 'production', HOSTNAME: '0.0.0.0', PORT: '3100' },
    },
    {
      name: 'vp-overwatch-ingest',
      cwd: '/home/cyrus/Documents/vp_overwatch/Tactical',
      script: 'scripts/adsb-ingest.ts',
      interpreter: 'node',
      interpreter_args: '--experimental-strip-types',
      autorestart: true,
      max_restarts: 20,
      // Server-only env (DATABASE_URL, ADSB_EXCHANGE_API_KEY, AUTH_SECRET, …)
      // is provided by the environment / secret manager, never committed here.
      env: { NODE_ENV: 'production' },
    },
  ],
}
