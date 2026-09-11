/**
 * Shared PostgreSQL pool (server-only).
 * A single pool per process, stashed on globalThis so Next hot-reloads and all
 * API routes share it. The ingestion worker constructs its own pool.
 *
 * DATABASE_URL is server-only and must never be exposed to the client.
 */
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

const g = globalThis as unknown as { __vpPool?: Pool }

export function getPool(): Pool {
  if (!g.__vpPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set (server-only durable state required)')
    }
    g.__vpPool = new Pool({
      connectionString,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
    g.__vpPool.on('error', (err) => console.error('[db] idle client error:', err.message))
  }
  return g.__vpPool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query<T>(text, params as any[])
  return { rows: res.rows, rowCount: res.rowCount ?? 0 }
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
