/**
 * Deleting an organisation and everything hanging off it.
 *
 * ## Two connections, in sequence, never nested
 *
 * The organisation row is the tenant's to delete, and deleting it cascades
 * through every tenant table — proved from the foreign keys in
 * `privacy-record.test.ts` rather than from a delete statement anybody could
 * forget to update.
 *
 * What cascades cannot reach is `users`. The tenant role may only SELECT that
 * table, and it should: a member of one organisation has no business deleting
 * a person who may belong to another. So the sign-in itself is removed
 * afterwards, on the operator connection, and only for somebody left with no
 * membership anywhere.
 *
 * The two never nest. Opening an operator connection inside a tenant
 * transaction is the deadlock this codebase has already had once.
 *
 * ## Why the account goes too
 *
 * Erasure that leaves an email address behind is not erasure. A person whose
 * only organisation is gone has nothing left here, and keeping their address
 * so they can sign in to an empty product is our convenience, not theirs.
 */

import type { Queryable } from './client.js';

/**
 * The people in an organisation, read before it is deleted.
 *
 * Read first because the membership rows are about to cascade away, and after
 * that there is no way to tell who was in it.
 */
export async function membersOf(tx: Queryable): Promise<string[]> {
  const { rows } = await tx.query<{ user_id: string }>('SELECT user_id FROM memberships');
  return rows.map((r) => r.user_id);
}

/**
 * Delete the organisation. Everything tenant-scoped goes with it.
 *
 * Returns false when there was nothing to delete, which under row-level
 * security covers both "already gone" and "not yours".
 */
export async function eraseOrganisation(
  tx: Queryable,
  organisationId: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    'DELETE FROM organisations WHERE id = $1 RETURNING id',
    [organisationId],
  );
  return rows.length > 0;
}

/**
 * Remove sign-ins that now belong to nobody.
 *
 * OPERATOR path, and deliberately narrow: only a user with no membership left
 * at all. Passwords and sessions cascade from `users`, so this signs them out
 * everywhere as a side effect of existing nowhere.
 *
 * Takes the candidates rather than scanning for orphans, so a bug elsewhere
 * cannot turn this into a sweep of everybody.
 */
export async function eraseOrphanedUsers(
  tx: Queryable,
  candidateIds: readonly string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const { rows } = await tx.query<{ id: string }>(
    `DELETE FROM users u
      WHERE u.id = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
      RETURNING u.id`,
    [[...candidateIds]],
  );
  return rows.map((r) => r.id);
}
