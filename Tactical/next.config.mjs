/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['100.94.31.125'],
  output: 'standalone',
  // Override the build output dir (used for a verify build so the live
  // .next served by the systemd unit is never disturbed). Defaults to .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Cache policy. Next serves the statically-prerendered app shell with a
  // year-long `s-maxage`, and there is no service worker to bust it — so a
  // phone / Capacitor webview that loaded an old build keeps serving that stale
  // HTML (which points at chunk hashes the new build deleted) and the map goes
  // black forever. Force the HTML *document* routes to always revalidate so
  // every app-open pulls the current shell + its content-hashed chunks. Static
  // assets under /_next/static and public files (e.g. /victoria.pmtiles) are
  // left untouched so they stay immutably cached.
  async headers() {
    const noStore = {
      key: 'Cache-Control',
      value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
    }
    return [
      { source: '/', headers: [noStore] },
      { source: '/vicpol-history', headers: [noStore] },
      { source: '/dashboard', headers: [noStore] },
      // Baseline security headers, applied to everything. Source-visible on
      // purpose: a review can verify them without inspecting the CDN, and they
      // cost nothing.
      //   nosniff          — stop a response being guessed into another type
      //   frame-ancestors  — the app must not be framed (with X-Frame-Options for
      //                      anything too old to know CSP)
      //   referrer-policy  — keep full URLs out of third-party logs
      //   permissions      — this app needs geolocation (the visitor's own dot) and
      //                      camera (the AR sky view) and nothing else
      //   HSTS             — the public domain is HTTPS-only through the tunnel; it
      //                      does not affect the plain-HTTP LAN address, because
      //                      HSTS is hostname-scoped
      // NOT included: a script-src/content-src CSP. That needs nonces or hashes
      // wired through Next and the MapLibre worker, and a half-written one either
      // breaks the map or gives false assurance. frame-ancestors is the containment
      // that matters for this app; the XSS class is fixed at the sink instead.
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default nextConfig
