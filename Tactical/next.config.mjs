/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['100.94.31.125'],
  output: 'standalone',

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
    ]
  },
}

export default nextConfig
