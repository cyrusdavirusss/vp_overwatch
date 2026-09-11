/**
 * Single-writer lease via a PostgreSQL session-level advisory lock. The
 * ingestion worker must hold this before it may write state, guaranteeing
 * exactly one active ingester across replicas. The lock is bound to ONE
 * dedicated connection (advisory locks are session-scoped) and released on
 * shutdown; a crashed worker's session ends and Postgres frees the lock.
 */
import { getPool } from './pool.ts'

const LOCK_KEY = 1448498007 // 'VPOW'

export interface Lease { release: () => Promise<void> }

export async function acquireIngestLease(): Promise<Lease | null> {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY])
    if (!rows[0]?.locked) {
      client.release()
      return null
    }
    return {
      release: async () => {
        try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]) }
        finally { client.release() }
      },
    }
  } catch (e) {
    client.release()
    throw e
  }
}

const PROXIMITY_NS = 0x50524f58 // 'PROX'

/**
 * Run `fn` while holding a session advisory lock keyed by (namespace, id),
 * serializing concurrent callers for the same id (e.g. per-user proximity
 * evaluation across the worker and the location endpoint). The lock is bound to
 * one dedicated client; inner work may still use the shared pool.
 */
export async function withProximityLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [PROXIMITY_NS, userId])
    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [PROXIMITY_NS, userId])
    }
  } finally {
    client.release()
  }
}
