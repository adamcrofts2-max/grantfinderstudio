/**
 * The audit trail. TENANT path.
 *
 * `audit_logs` was the last table 0001 created with nothing writing to it.
 * Closing that gap is worth doing on its own — "who on our team changed this,
 * and when" is a fair question in an organisation with more than one person in
 * it — but the reason it is next is Phase 9 Step 2. Sharing an application
 * read-only with a reviewer the applicant names is a processor relationship,
 * and the roadmap's own words are that it must be scoped, time-boxed,
 * revocable and AUDITED. There is no audited access without an audit log.
 *
 * ## Written in the same transaction as the thing it records
 *
 * Not after it, and not fire-and-forget. Both alternatives are worse in the
 * same direction:
 *
 *   - Outside the transaction, the trail can record a change that rolled back.
 *     A line saying something happened that did not is worse than no line,
 *     because it makes every other line uncheckable.
 *   - Swallowed, the trail can silently stop. An audit log with gaps is worse
 *     than none at all: absence stops meaning anything, so the whole record
 *     stops being evidence of anything.
 *
 * So a failed audit write fails the action it was recording. That is the
 * trade this table exists to make — no record, no change — and it is the only
 * one consistent with access being lawful because it is audited.
 *
 * ## `metadata` carries SHAPE, never CONTENT
 *
 * A word count, an amount, a category, a title. Never the answer's prose.
 * Copying answer text in here would make a second, unversioned store of the
 * applicant's writing outside `answer_versions` — and then hand it to whoever
 * the application is shared with. `answer_versions` already keeps every save;
 * this says that a save happened.
 */

import type { Queryable } from './client.js';
import { auditEntityType, type AuditAction } from '../domain/audit/actions.js';

export interface AuditEntry {
  /** Who did it. Null only for something the system did unprompted. */
  userId: string | null;
  action: AuditAction;
  /** The row the action was about, where there is one. */
  entityId?: string | null;
  /**
   * The application this belongs to, or null for an organisation-level event.
   *
   * A column rather than a key in `metadata` because a reviewer given one
   * application must not be shown the organisation's others, so the trail has
   * to be selectable by application reliably — see migration 0022.
   */
  applicationId?: string | null;
  /** Shape, not content. See the note above. */
  metadata?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  applicationId: string | null;
  userId: string | null;
  metadata: Record<string, unknown>;
  /** ISO with a Z, so `new Date()` accepts it — see `reviews.ts`. */
  createdAt: string;
}

export async function recordAudit(
  tx: Queryable,
  organisationId: string,
  entry: AuditEntry,
): Promise<void> {
  const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await tx.query(
    `INSERT INTO audit_logs
       (id, organisation_id, user_id, action, entity_type, entity_id,
        application_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      organisationId,
      entry.userId,
      entry.action,
      // Derived, never passed: see `auditEntityType`.
      auditEntityType(entry.action),
      entry.entityId ?? null,
      entry.applicationId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

/** How many lines one screen shows before "and more before that". */
const TRAIL_LIMIT = 40;

/**
 * The trail, newest first.
 *
 * ## Why `organisationId` is an argument and not left to RLS
 *
 * RLS scopes this correctly in production, and that was the whole predicate
 * for one draft. Then seeding a row per tenant in the shared test harness
 * made this function return five rows where the test expected three — because
 * the tests connect as a superuser, and a superuser bypasses RLS entirely.
 *
 * The test was brittle and the function was worse: an audit trail is the table
 * that will prove a reviewer's access was lawful, read on the one screen built
 * to be shown to somebody outside the organisation. A reader whose only
 * defence is a policy nobody can see from the call site is one connection
 * setting away from being the leak. So it filters, and RLS refuses as well.
 *
 * `applicationId` narrows it to one application AND the organisation-level
 * events are left out — not folded in. A reviewer reading one application is
 * being shown that application's history, and "a fact was confirmed" or "a
 * document was uploaded" is the organisation's business, not this
 * application's.
 *
 * The timestamp is emitted as ISO with a Z rather than `::text`: a timestamptz
 * rendered by Postgres carries a `+00` offset that `new Date()` refuses, which
 * degraded every stored review's date to the word "earlier" until it was
 * found in a browser.
 */
export async function loadAuditTrail(
  tx: Queryable,
  organisationId: string,
  options: { applicationId?: string | null; limit?: number } = {},
): Promise<AuditRow[]> {
  const limit = options.limit ?? TRAIL_LIMIT;
  const scoped = options.applicationId != null && options.applicationId !== '';
  const { rows } = await tx.query<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    application_id: string | null;
    user_id: string | null;
    metadata: unknown;
    created_at: string;
  }>(
    `SELECT id, action, entity_type, entity_id, application_id, user_id, metadata,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
       FROM audit_logs
      WHERE organisation_id = $1${scoped ? ' AND application_id = $2' : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ${scoped ? '$3' : '$2'}`,
    scoped ? [organisationId, options.applicationId, limit] : [organisationId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    applicationId: row.application_id,
    userId: row.user_id,
    // Defensive for the same reason `loadLatestReview` is: this column is
    // jsonb, it outlives the code that wrote it, and a trail that cannot
    // render is a trail nobody can check.
    metadata:
      typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  }));
}
