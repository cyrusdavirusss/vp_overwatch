// Deployment sync for the web app.
//
// After `next build` + copy-standalone.mjs, `.next/standalone/` is a fully
// self-contained Node server (server.js + public/ + .next/static/). This step
// mirrors that tree into the repo-root `dist/web/` so `dist/` is the single
// deployment target.
//
// NOTE: `dist/` at the repo root is a release directory that already holds
// curated, git-tracked platform bundles (android/, ios/, windows/, *.apk,
// *.zip). We deliberately write the web deployable into a dedicated
// `dist/web/` subfolder so those existing artifacts are never overwritten.
// Run the result with: `node dist/web/server.js` (PORT env selects the port).

import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const tacticalRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(tacticalRoot)
const standalone = join(tacticalRoot, '.next', 'standalone')
const distWeb = join(repoRoot, 'dist', 'web')

if (!existsSync(standalone)) {
  console.error(
    '[sync-dist] no .next/standalone output found — run the build first.',
  )
  process.exit(1)
}

// Replace dist/web/ atomically-ish: clear then copy the full standalone tree.
rmSync(distWeb, { recursive: true, force: true })
mkdirSync(distWeb, { recursive: true })
cpSync(standalone, distWeb, { recursive: true })

console.log(`[sync-dist] copied .next/standalone/ -> ${distWeb}`)
console.log('[sync-dist] deploy with: node dist/web/server.js')
