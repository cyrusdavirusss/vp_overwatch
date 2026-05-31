// Post-build step for `output: 'standalone'`.
//
// Next.js emits a minimal server at .next/standalone/server.js but does NOT
// copy public/ or .next/static/ into it. Without this, the standalone server
// 404s on static assets — including the self-hosted basemap public/victoria.pmtiles.
// This copies both into the standalone tree so `node .next/standalone/server.js`
// serves the app (and the PMTiles) exactly like dev.

import { existsSync, cpSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

if (!existsSync(standalone)) {
  console.log('[copy-standalone] no standalone output (output !== "standalone"); skipping')
  process.exit(0)
}

if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true })
  console.log('[copy-standalone] copied public/ -> .next/standalone/public/')
}

cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true })
console.log('[copy-standalone] copied .next/static/ -> .next/standalone/.next/static/')
console.log('[copy-standalone] done. run: node .next/standalone/server.js')
