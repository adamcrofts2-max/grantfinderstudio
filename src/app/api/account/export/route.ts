import { getDatabase, withAdmin } from '@/db';
import { authorise } from '@/app/authorise';
import { recordAudit } from '@/db/audit';
import {
  exportOrganisation,
  namesFor,
  seatsIn,
  withMembers,
} from '@/db/export';

export const dynamic = 'force-dynamic';

/**
 * Download everything this product holds about the organisation.
 *
 * ## Why a file and not a screen
 *
 * The point of an export is that it is yours once you have it — readable
 * without us, and loadable into something else. A screen you can scroll is a
 * view of our database; a file is a copy of your data. JSON because it is
 * lossless and every row of every table is in it, with a legend so it can be
 * read without the schema beside it.
 *
 * ## Two connections, in sequence
 *
 * The tables come from the tenant connection, where row-level security does
 * the scoping. The members' email addresses come from the operator connection,
 * because 0009 revoked the tenant role's SELECT on `users` on purpose and an
 * export is not a reason to hand it back. Sequential, never nested: opening an
 * operator connection inside a tenant transaction is a deadlock this codebase
 * has already had.
 */
export async function GET(): Promise<Response> {
  // Admins and owners. One file carries every colleague's address and every
  // answer off the platform, which is a different act from reading them here.
  const who = await authorise('organisation:export');
  if (!who.ok) {
    return new Response(
      'Only an owner or admin of this organisation can download everything it holds. Ask one of them.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }
  const { organisationId, userId } = who;

  const database = await getDatabase();
  const { dump, seats } = await database.withTenant(organisationId, async (tx) => {
    const taken = await exportOrganisation(tx, organisationId);
    const members = await seatsIn(tx);
    // Recorded inside the same transaction as the read, so the trail cannot
    // disagree with what was handed over.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'account.exported',
      entityId: organisationId,
      metadata: { tables: Object.keys(taken.data).length },
    });
    return { dump: taken, seats: members };
  });

  const names = await withAdmin((tx) => namesFor(tx, seats.map((seat) => seat.userId)));
  const full = withMembers(dump, seats, names);

  const day = full.takenAt.slice(0, 10);
  return new Response(JSON.stringify(full, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="grant-finder-studio-export-${day}.json"`,
      'cache-control': 'no-store',
    },
  });
}
