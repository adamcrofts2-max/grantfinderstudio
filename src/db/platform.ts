/**
 * What the console reads. OPERATOR scope throughout.
 *
 * Every query in this file runs through `withOperator`, whose role holds
 * SELECT on the platform's own tables and no grant whatsoever on a tenant
 * table (0009). That is the boundary: a query added here that reached for
 * `facts` or `applications` would not return the wrong answer, it would fail
 * with "permission denied" in development and in the deployment alike.
 *
 * So there is no accounting of "how many projects" or "how many applications"
 * on this console, and there cannot be. Those numbers would be pleasant to
 * have on a dashboard and they are not worth a hole in the one promise this
 * product makes.
 */

import type { Queryable } from './client.js';

export interface AccountSummary {
  total: number;
  lastSevenDays: number;
}

export async function readAccountSummary(tx: Queryable): Promise<AccountSummary> {
  const { rows } = await tx.query<{ total: number; recent: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS recent
       FROM users`,
  );
  return { total: rows[0]?.total ?? 0, lastSevenDays: rows[0]?.recent ?? 0 };
}

export interface AccountRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

/**
 * The account list.
 *
 * An address and a sign-up date. Not what they are applying for, not who they
 * are applying to, not a word they have written — the operator role could not
 * fetch those if this function asked.
 */
export async function readAccounts(tx: Queryable, limit = 100): Promise<AccountRow[]> {
  const { rows } = await tx.query<{
    id: string;
    email: string;
    name: string | null;
    created_at: Date | string;
  }>(
    `SELECT id, email, name, created_at FROM users
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }));
}

export interface CatalogueSummary {
  funders: number;
  sharedOpportunities: number;
  /** Opportunities a tenant pasted in. A COUNT, never their contents. */
  tenantOpportunities: number;
}

export async function readCatalogueSummary(tx: Queryable): Promise<CatalogueSummary> {
  const { rows } = await tx.query<{ funders: number; shared: number; tenant: number }>(
    `SELECT
       (SELECT count(*) FROM funders)::int AS funders,
       (SELECT count(*) FROM opportunities
         WHERE added_by_organisation_id IS NULL)::int AS shared,
       (SELECT count(*) FROM opportunities
         WHERE added_by_organisation_id IS NOT NULL)::int AS tenant`,
  );
  return {
    funders: rows[0]?.funders ?? 0,
    sharedOpportunities: rows[0]?.shared ?? 0,
    tenantOpportunities: rows[0]?.tenant ?? 0,
  };
}

export interface SharedFund {
  id: string;
  title: string;
  funderName: string;
  minAmountGbp: number | null;
  maxAmountGbp: number | null;
  deadline: Date | null;
  deadlineKind: string;
  sourceUrl: string | null;
}

/**
 * The shared catalogue — funds every organisation can see.
 *
 * `added_by_organisation_id IS NULL` is what makes a fund shared. A fund a
 * tenant pasted in is theirs, is filtered out here, and would be refused by
 * the policy anyway.
 */
export async function readSharedFunds(tx: Queryable, limit = 200): Promise<SharedFund[]> {
  const { rows } = await tx.query<{
    id: string;
    title: string;
    funder_name: string;
    min_amount_gbp: string | null;
    max_amount_gbp: string | null;
    deadline: Date | string | null;
    deadline_kind: string;
    source_url: string | null;
  }>(
    `SELECT o.id, o.title, f.name AS funder_name, o.min_amount_gbp, o.max_amount_gbp,
            o.deadline, o.deadline_kind, o.source_url
       FROM opportunities o
       JOIN funders f ON f.id = o.funder_id
      WHERE o.added_by_organisation_id IS NULL
      ORDER BY o.deadline NULLS LAST, o.title
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    funderName: row.funder_name,
    minAmountGbp: row.min_amount_gbp === null ? null : Number(row.min_amount_gbp),
    maxAmountGbp: row.max_amount_gbp === null ? null : Number(row.max_amount_gbp),
    deadline:
      row.deadline === null
        ? null
        : row.deadline instanceof Date
          ? row.deadline
          : new Date(row.deadline),
    deadlineKind: row.deadline_kind,
    sourceUrl: row.source_url,
  }));
}

export interface ThrottleSummary {
  buckets: number;
  /** Buckets with enough failures in them to be turning somebody away. */
  blocking: number;
}

export async function readThrottleSummary(
  tx: Queryable,
  blockingAt: number,
): Promise<ThrottleSummary> {
  const { rows } = await tx.query<{ buckets: number; blocking: number }>(
    `SELECT count(*)::int AS buckets,
            count(*) FILTER (WHERE attempts >= $1)::int AS blocking
       FROM auth_attempts
      WHERE window_started_at > now() - interval '1 hour'`,
    [blockingAt],
  );
  return { buckets: rows[0]?.buckets ?? 0, blocking: rows[0]?.blocking ?? 0 };
}
