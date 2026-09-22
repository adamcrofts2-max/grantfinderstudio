'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { getDatabase, withAdmin } from '@/db';
import { requireOrganisationId, SESSION_COOKIE } from '@/app/session';
import { loadOrganisation } from '@/db/queries';
import { eraseOrganisation, eraseOrphanedUsers, membersOf } from '@/db/erasure';
import { confirms } from '@/domain/privacy/erasure';

import { EMPTY_ERASE, type EraseState } from './state';

/**
 * Delete the organisation and everything in it.
 *
 * ## The order is the whole design
 *
 * 1. Read who is in it, BEFORE the memberships cascade away — after the
 *    delete there is no way to tell who was.
 * 2. Delete the organisation on the tenant connection. Row-level security
 *    means this can only ever be the caller's own, and the foreign keys take
 *    every tenant table with it.
 * 3. On the operator connection, and only afterwards, remove sign-ins left
 *    belonging to no organisation at all.
 * 4. Drop the session cookie, because the session row went with the user.
 *
 * Steps 2 and 3 are sequential and never nested: `withAdmin` refuses to run
 * inside `withTenant`, and for good reason.
 *
 * ## Why there is no audit entry for this
 *
 * `audit_logs` is tenant-scoped and cascades. A line recording the erasure
 * would be deleted by the thing it describes. What survives an erasure is
 * nothing — which is the point of one.
 */
export async function eraseOrganisationAction(
  _previous: EraseState,
  formData: FormData,
): Promise<EraseState> {
  const organisationId = await requireOrganisationId();
  const typed = String(formData.get('confirm') ?? '');

  const database = await getDatabase();
  const organisation = await database.withTenant(organisationId, (tx) => loadOrganisation(tx));
  const name = organisation?.name ?? null;

  if (!confirms(typed, name)) {
    return {
      ...EMPTY_ERASE,
      value: typed,
      message:
        typed.trim() === ''
          ? 'Type the name to confirm. Nothing has been deleted.'
          : 'That does not match, so nothing has been deleted. Check you are in the right account.',
    };
  }

  const members = await database.withTenant(organisationId, async (tx) => {
    const who = await membersOf(tx);
    await eraseOrganisation(tx, organisationId);
    return who;
  });

  await withAdmin((tx) => eraseOrphanedUsers(tx, members));

  // The session row cascaded with the user. Clearing the cookie stops the
  // browser presenting a token that no longer resolves to anything.
  (await cookies()).delete(SESSION_COOKIE);

  redirect('/?erased=1');
}
