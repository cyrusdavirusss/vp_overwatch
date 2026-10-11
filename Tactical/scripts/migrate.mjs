#!/usr/bin/env node
/**
 * Idempotent schema migration runner.
 * Usage: DATABASE_URL=postgres://... node scripts/migrate.mjs
 * Safe to run repeatedly (schema uses CREATE ... IF NOT EXISTS).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(__dirname, '..', 'lib', 'db', 'schema.sql')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('[migrate] DATABASE_URL is required')
  process.exit(1)
}

const sql = readFileSync(schemaPath, 'utf8')
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000 })

try {
  await pool.query(sql)
  console.log('[migrate] schema applied OK')
  process.exit(0)
} catch (err) {
  console.error('[migrate] failed:', err.message)
  process.exit(1)
} finally {
  await pool.end()
}
