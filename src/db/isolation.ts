import { withAdmin } from './index.js';

/**
 * Is the tenant role actually subject to Row-Level Security?
 *
 * Worth asserting rather than assuming, because a managed host can hand the
 * connecting role privileges that quietly undo the whole isolation story.
 * Neon's `neondb_owner` inherits `neon_superuser`, which carries BYPASSRLS —
 * harmless in itself, since tenant queries run after `SET LOCAL ROLE app_user`
 * and BYPASSRLS is a property of the role in effect. But if `app_user` ever
 * acquired it — granted by hand, or created through a console that confers it
 * — every policy in the schema would silently stop applying and nothing else
 * would look different.
 *
 * Silent is the problem. This makes it loud.
 */

export interface IsolationReport {
  /** False when app_user could read across tenants. */
  enforced: boolean;
  problems: string[];
}

export async function checkIsolation(): Promise<IsolationReport> {
  const problems: string[] = [];

  await withAdmin(async (tx) => {
    const { rows } = await tx.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
      ['app_user'],
    );
    const role = rows[0];
    if (role === undefined) {
      problems.push(
        'The app_user role does not exist, so no tenant query is subject to Row-Level Security.',
      );
      return;
    }
    if (role.rolbypassrls) {
      problems.push(
        'app_user has BYPASSRLS, so every tenant policy is being ignored. ' +
          'Fix with: ALTER ROLE app_user NOBYPASSRLS;',
      );
    }
    if (role.rolsuper) {
      problems.push(
        'app_user is a superuser, which bypasses Row-Level Security entirely. ' +
          'Fix with: ALTER ROLE app_user NOSUPERUSER;',
      );
    }

    // A policy on a table that never had RLS switched on is decoration.
    const { rows: unprotected } = await tx.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
          AND NOT c.relrowsecurity`,
    );
    for (const row of unprotected) {
      problems.push(`${row.relname} has a policy but Row-Level Security is not enabled on it.`);
    }
  });

  return { enforced: problems.length === 0, problems };
}
