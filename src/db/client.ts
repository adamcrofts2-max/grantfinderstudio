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
      return fn(tx);
    });
  }
}
