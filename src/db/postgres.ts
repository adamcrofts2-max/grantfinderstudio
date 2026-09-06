/**
 * Production Postgres adapter.
 *
 * The application connects as the schema owner, then drops to the
 * unprivileged `app_user` role for the duration of every tenant transaction:
 *
 *   BEGIN
 *     SET LOCAL ROLE app_user            -- limited grants, subject to RLS
 *     set_config('app.organisation_id', …, true)   -- transaction-local
 *     … the request's queries …
 *   COMMIT                               -- both settings discarded
 *
 * Both are transaction-local, so neither can survive onto the next request
 * that borrows this pooled connection. That is the property `client.test.ts`
 * proves, and it is why the role switch lives here in the adapter rather than
 * being left to the caller to remember.
 *
 * Operator credentials are the one thing `app_user` is granted no access to,
 * so `withAdmin` deliberately does not switch role.
 */

import { Pool, type PoolClient } from 'pg';
import type { Queryable, QueryResult, TransactionCapable } from './client.js';
import type { MigrationExecutor } from './migrate.js';

const TENANT_ROLE = 'app_user';

function wrap(client: PoolClient): MigrationExecutor {
  return {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await client.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
    /**
     * Multi-statement scripts. Passing no parameters keeps node-postgres on
     * the simple query protocol, which accepts more than one statement.
     */
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
  };
}

export class PostgresDatabase implements TransactionCapable {
  constructor(private readonly pool: Pool) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params as unknown[] | undefined);
    return { rows: result.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  /** Tenant transaction: unprivileged role, RLS in force. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${TENANT_ROLE}`);
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Operator transaction, running as the owner.
   *
   * Only for the platform's own service credentials, which belong to no
   * tenant. Never read tenant data through this — RLS does not apply.
   */
  async adminTransaction<T>(fn: (tx: MigrationExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // Managed Postgres (Neon, Supabase, RDS) terminates TLS with its own CA;
    // the connection is encrypted, the certificate chain is not verified here.
    ssl: /sslmode=require|ssl=true/u.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
