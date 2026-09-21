/**
 * Review shares. TENANT path for the applicant, and one deliberate exception.
 *
 * ## The one query here that is not tenant-scoped, and why it has to be
 *
 * A reviewer arrives with a link and no account. There is no session, so there
 * is no tenant context — and RLS is what makes every other read safe. So the
 * token itself has to establish the tenant, which means exactly one query runs
 * on the owner connection: `resolveShare`, which turns a token hash into the
 * organisation and application it names and nothing else.
 *
 * That is the same shape session resolution has always had — `readSession`
 * resolves a cookie on the owner connection before any tenant read happens —
 * and it is bounded the same way: the query selects by `token_hash`, a
 * SHA-256 of 32 bytes of CSPRNG output, and returns one row or none. Every
 * read of the application's own data afterwards goes through `withTenant` with
 * the organisation the token named, so a reviewer is inside the same policy a
 * member is.
 *
 * And it is bounded by the DATABASE as well as by this file. `FORCE ROW LEVEL
 * SECURITY` binds the table owner too, so the owner connection sees no share
 * at all unless it first says which token it is holding: `resolveShare` sets
 * `app.share_token_hash` for the length of its transaction, and migration
 * 0024's policy lets through exactly the row with that hash. Nothing here can
 * read a second share, or a share by any other means, however this function
 * is called.
 *
 * What stops a token being guessed is its entropy, not the query. What stops a
 * valid token reading the wrong thing is that `resolveShare` returns the
 * application id and the caller may read no other.
 */

import type { Queryable } from './client.js';
import { hashShareToken } from '../auth/token.js';
import { shareStanding, type ShareStanding } from '../domain/review/share.js';

export interface ShareRow {
  id: string;
  applicationId: string;
  reviewerName: string;
  /** ISO with a Z, so `new Date()` accepts it. */
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  views: number;
}

/** What a token resolves to, before any of the application is read. */
export interface ResolvedShare {
  id: string;
  organisationId: string;
  applicationId: string;
  reviewerName: string;
  standing: ShareStanding;
  expiresAt: string;
}

/**
 * ISO with a Z for every timestamp this module returns.
 *
 * `created_at::text` renders a timestamptz with a `+00` offset that
 * `new Date()` refuses, which degraded every stored review's date to the word
 * "earlier" until a browser showed it. Same column type, same trap.
 */
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', ${ISO})`;

const COLUMNS = `id, application_id, reviewer_name,
       ${iso('created_at')} AS created_at,
       ${iso('expires_at')} AS expires_at,
       ${iso('revoked_at')} AS revoked_at,
       ${iso('first_viewed_at')} AS first_viewed_at,
       ${iso('last_viewed_at')} AS last_viewed_at,
       views`;

interface Row {
  id: string;
  application_id: string;
  reviewer_name: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  views: number;
}

const toShare = (row: Row): ShareRow => ({
  id: row.id,
  applicationId: row.application_id,
  reviewerName: row.reviewer_name,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  firstViewedAt: row.first_viewed_at,
  lastViewedAt: row.last_viewed_at,
  views: row.views,
});

/**
 * Create a share. The caller keeps the token; only its hash is stored.
 *
 * `expiresAt` is required by the signature as well as by the column, because
 * a default here would be a default nobody sees — and the one thing this
 * feature must not have is a share that outlives the reason for it.
 */
export async function createShare(
  tx: Queryable,
  organisationId: string,
  share: {
    applicationId: string;
    reviewerName: string;
    tokenHash: string;
    expiresAt: Date;
    createdBy: string | null;
  },
): Promise<ShareRow> {
  const id = `shr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await tx.query<Row>(
    `INSERT INTO application_shares
       (id, organisation_id, application_id, token_hash, reviewer_name,
        created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      id,
      organisationId,
      share.applicationId,
      share.tokenHash,
      share.reviewerName,
      share.createdBy,
      share.expiresAt.toISOString(),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the share was not created');
  return toShare(row);
}

/** The applicant's own shares for one application, newest first. */
export async function loadShares(
  tx: Queryable,
  applicationId: string,
): Promise<ShareRow[]> {
  const { rows } = await tx.query<Row>(
    `SELECT ${COLUMNS}
       FROM application_shares
      WHERE application_id = $1
      ORDER BY created_at DESC, id DESC`,
    [applicationId],
  );
  return rows.map(toShare);
}

/**
 * Withdraw a share.
 *
 * Scoped by application as well as by id, for the reason `budget.ts` gives:
 * an id from one application must not act on another's row even inside the
 * same organisation. Idempotent — revoking twice keeps the first time, which
 * is when access actually stopped.
 */
export async function revokeShare(
  tx: Queryable,
  applicationId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE application_shares
        SET revoked_at = now()
      WHERE id = $1 AND application_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [id, applicationId],
  );
  return rows.length > 0;
}

/**
 * Turn a token into the organisation and application it names.
 *
 * THE OWNER CONNECTION, deliberately — see the note at the top of this file.
 * It returns the standing rather than filtering on it: a refused reviewer is
 * told whether the link was withdrawn or ran out, and that needs the row.
 *
 * Nothing about the application is read here. The caller takes the
 * organisation id, opens a tenant transaction with it, and may read that one
 * application.
 */
export async function resolveShare(
  tx: Queryable,
  token: string,
  now: Date,
): Promise<ResolvedShare | null> {
  if (token.trim() === '') return null;
  const tokenHash = hashShareToken(token);
  // The permission, stated to the database: this transaction is holding that
  // token. LOCAL, so it is gone when the transaction ends and cannot travel
  // to the next caller on a pooled connection. Without it the policy in 0024
  // matches nothing and this returns null, which is the right way round: a
  // caller that has not said what it holds may read nothing.
  await tx.query(`SELECT set_config('app.share_token_hash', $1, true)`, [tokenHash]);
  const { rows } = await tx.query<{
    id: string;
    organisation_id: string;
    application_id: string;
    reviewer_name: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, organisation_id, application_id, reviewer_name,
            ${iso('expires_at')} AS expires_at,
            ${iso('revoked_at')} AS revoked_at
       FROM application_shares
      WHERE token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    organisationId: row.organisation_id,
    applicationId: row.application_id,
    reviewerName: row.reviewer_name,
    standing: shareStanding({ expiresAt: row.expires_at, revokedAt: row.revoked_at }, now),
    expiresAt: row.expires_at,
  };
}

/** What a read amounted to, for the trail to decide whether to record it. */
export interface ShareVisit {
  /** How many reads this link has had, including this one. */
  views: number;
  /** When it was last read BEFORE this one. Null on the first read. */
  previousViewAt: string | null;
}

/**
 * Record that a reviewer opened it.
 *
 * `first_viewed_at` is set once and never moved, so "opened once, three weeks
 * ago" stays distinguishable from "opened eleven times, last night" — two
 * different facts about the same link, and the applicant may care about
 * either.
 *
 * It returns the previous read's time, which the caller needs and could not
 * get afterwards: this statement overwrites it. That is what `isNewVisit`
 * decides on, so that a reviewer reloading the page eleven times leaves
 * eleven views on this row and one line in the audit trail.
 *
 * The previous value comes from a CTE rather than `RETURNING`, because
 * `RETURNING` hands back the row as it now is — the value this statement has
 * just replaced is exactly what is wanted and exactly what it cannot give.
 *
 * On the TENANT connection, with the organisation the token just named. The
 * first draft ran it on the owner connection, on the reasoning that a request
 * with no session has no tenant — but by the time this is called the token
 * HAS established one, and 0024's read-only policy would not have covered a
 * write anyway. So the view count is written inside the same tenant
 * transaction as the audit line it belongs with, under the same policy as
 * every other write this organisation's data ever receives.
 */
export async function recordShareView(tx: Queryable, id: string): Promise<ShareVisit> {
  const { rows } = await tx.query<{ views: number; previous_view_at: string | null }>(
    `WITH previous AS (
       SELECT id, last_viewed_at FROM application_shares WHERE id = $1
     ), bumped AS (
       UPDATE application_shares s
          SET views = s.views + 1,
              first_viewed_at = coalesce(s.first_viewed_at, now()),
              last_viewed_at = now()
         FROM previous p
        WHERE s.id = p.id
       RETURNING s.views
     )
     SELECT bumped.views,
            ${iso('previous.last_viewed_at')} AS previous_view_at
       FROM bumped, previous`,
    [id],
  );
  const row = rows[0];
  // A share that vanished between resolving the token and recording the read.
  // Nothing to record, and nothing worth failing a reviewer's page over.
  if (row === undefined) return { views: 0, previousViewAt: null };
  return { views: row.views, previousViewAt: row.previous_view_at };
}
