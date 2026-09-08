/**
 * Tenant-scoped database access.
 *
 * Every Row-Level Security policy in this schema reads
 * `current_setting('app.organisation_id')`. That setting is therefore the
 * single point at which the whole isolation guarantee could be undone from the
 * application side, in one specific way: a connection returned to the pool
 * still carrying the previous request's tenant.
 *
 * The defence is that the setting is only ever written with `set_config(..., true)`
 * — the function form of `SET LOCAL` — inside a transaction. Postgres discards
 * it when the transaction ends, whether it commits or rolls back, so it cannot
 * outlive the request that set it. There is a test for exactly that.
 *
 * There is deliberately no API here for querying without a tenant.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface QueryResult<T> {
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface TransactionCapable extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

export class InvalidTenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTenantError';
  }
}

/**
 * Reject a tenant id that would silently match the wrong rows.
 *
 * An empty string is the dangerous case: it is not NULL, so the policy
 * comparison succeeds against any row whose organisation_id is also empty,
 * rather than failing closed the way an unset context does.
 */
export function assertValidTenantId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new InvalidTenantError(
      'A tenant id is required and must be a non-empty string.',
    );
  }
}

/**
 * Whether the current call stack is inside an open tenant transaction.
 *
 * This exists to make one specific mistake loud. Opening an operator
 * connection while a tenant transaction is held is a deadlock: the dev
 * database is a single connection and waits on itself forever, and a pool
 * under load exhausts itself the same way. A deadlock gives you no error, no
 * log line and no stack — just a request that never returns, which is the
 * worst failure mode we have. `withAdmin` consults this and throws instead.
 */
const OPEN_TENANT_TRANSACTION = new AsyncLocalStorage<true>();

export function inTenantTransaction(): boolean {
  return OPEN_TENANT_TRANSACTION.getStore() === true;
}

export class TenantDatabase {
  constructor(private readonly db: TransactionCapable) {}

  /**
   * Run `fn` with the tenant context set, inside a transaction.
   *
   * The context is transaction-local, so it is gone the moment this resolves
   * or rejects.
   */
  async withTenant<T>(
    organisationId: string,
    fn: (tx: Queryable) => Promise<T>,
  ): Promise<T> {
    assertValidTenantId(organisationId);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT set_config($1, $2, true)', [
        'app.organisation_id',
        organisationId,
      ]);
      return OPEN_TENANT_TRANSACTION.run(true, () => fn(tx));
    });
  }

  /**
   * Run `fn` as a signed-in USER rather than as a tenant.
   *
   * Exactly one thing needs this: finding which organisations somebody belongs
   * to, at sign-in, before there is a tenant to be. That read cannot go
   * through `withTenant` — it is what decides the tenant — and it must not go
   * through `withAdmin`, which would read every membership on the platform to
   * answer a question about one person.
   *
   * So it runs unprivileged, with `app.user_id` set transaction-locally, and
   * the `own_memberships` policy in 0007 lets it see that user's rows and
   * nothing else. `app.organisation_id` is deliberately NOT set, so every
   * tenant-scoped table stays empty in here: this context can answer "which
   * organisations are mine" and no other question.
   */
  async withUser<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    assertValidTenantId(userId);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      return OPEN_TENANT_TRANSACTION.run(true, () => fn(tx));
    });
  }
}
