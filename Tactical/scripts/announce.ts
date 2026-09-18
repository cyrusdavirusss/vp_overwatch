#!/usr/bin/env node
/**
 * Publish, list and withdraw operator announcements from the command line.
 *
 *   node --experimental-strip-types scripts/announce.ts post "Title" "Body text" [--level notice] [--hours 6] [--pin]
 *   node --experimental-strip-types scripts/announce.ts list
 *   node --experimental-strip-types scripts/announce.ts withdraw 3
 *
 * Why a script and not a web form: the operator drives everything through the agent, so
 * authoring should be one command with no token to paste. This talks to the database
 * directly through the same lib the API uses, which also means it fans the push out with
 * the identical code path — there is no second delivery implementation to drift.
 *
 * The HTTP authoring route (/api/admin/announcements) still exists for remote use; both
 * land in the same table and the same ledger.
 *
 * DATABASE_URL is read from .env.local when it is not already in the environment.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// Minimal .env.local loader: this script runs outside Next, and a missing DATABASE_URL
// would otherwise fail deep inside the pool with a confusing message.
function loadEnvLocal() {
  if (process.env.DATABASE_URL) return
  try {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    console.error('[announce] no .env.local and no DATABASE_URL in the environment')
  }
}

function parseFlags(argv: string[]) {
  const flags: Record<string, string | boolean> = {}
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { flags[key] = next; i++ }
      else flags[key] = true
    } else rest.push(a)
  }
  return { flags, rest }
}

const LEVELS = ['info', 'notice', 'warning', 'critical']

async function main() {
  loadEnvLocal()
  const [cmd, ...argv] = process.argv.slice(2)
  const { flags, rest } = parseFlags(argv)

  const ann = await import(join(ROOT, 'lib', 'announcements.ts'))

  switch (cmd) {
    case 'post': {
      const [title, body] = rest
      if (!title || !body) {
        console.error('usage: announce post "Title" "Body" [--level info|notice|warning|critical] [--hours N] [--pin]')
        process.exit(2)
      }
      const level = typeof flags.level === 'string' && LEVELS.includes(flags.level)
        ? flags.level
        : 'info'
      const hours = Number(flags.hours)
      const created = await ann.createAnnouncement({
        title,
        body,
        level,
        pinned: flags.pin === true,
        expiresAt: Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null,
        createdBy: process.env.USER || 'operator',
      })
      const deliveries = await ann.deliverAnnouncement(created)
      console.log(`published #${created.id}  [${created.level}]  ${created.title}`)
      console.log(`  expires: ${created.expiresAt ? new Date(created.expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', hour12: false }) : 'when withdrawn'}`)
      console.log(`  push: ${deliveries.sent} sent, ${deliveries.failed} failed of ${deliveries.recipients} subscriber(s) with push on`)
      break
    }
    case 'list': {
      const all = await ann.listAllAnnouncements(20)
      if (!all.length) { console.log('no announcements'); break }
      for (const a of all) {
        const tally = await ann.deliverySummary(a.id)
        const state = a.withdrawnAt ? 'withdrawn' : (a.expiresAt && a.expiresAt < Date.now() ? 'expired' : 'live')
        const when = new Date(a.publishedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', hour12: false })
        console.log(`#${String(a.id).padStart(2)}  ${state.padEnd(9)} ${a.level.padEnd(8)} ${when}  push ${tally.sent}/${tally.sent + tally.failed}  ${a.title}`)
      }
      break
    }
    case 'withdraw': {
      const id = Number(rest[0])
      if (!Number.isFinite(id)) { console.error('usage: announce withdraw <id>'); process.exit(2) }
      const done = await ann.withdrawAnnouncement(id)
      console.log(done ? `withdrawn #${done.id}  ${done.title}` : `#${id} not found or already withdrawn`)
      break
    }
    default:
      console.error('usage: announce <post|list|withdraw> ...')
      process.exit(2)
  }
  process.exit(0)
}

main().catch((e) => { console.error('[announce]', e?.message || e); process.exit(1) })
