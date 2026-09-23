import { getDatabase } from '@/db';
import { roleOf } from '@/db/membership';
import { can, type Permission, type Role } from '@/auth/rbac';
import { requireOrganisationId, requireUserId } from '@/app/session';

/**
 * May the person making this request do this, in this organisation?
 *
 * The one place the permission matrix meets a request. Returns a verdict
 * rather than throwing, because the callers answer differently — a route with
 * a 403, a form with a sentence — and a throw inside a server action becomes
 * an error page instead of either.
 *
 * Fails closed: no membership, or a role this version does not know, is a
 * refusal.
 */
export type Authorised =
  | { ok: true; organisationId: string; userId: string; role: Role }
  | { ok: false; organisationId: string; userId: string; role: Role | null };

export async function authorise(permission: Permission): Promise<Authorised> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const database = await getDatabase();
  const role = await database.withTenant(organisationId, (tx) => roleOf(tx, userId));
  if (role !== null && can(role, permission)) {
    return { ok: true, organisationId, userId, role };
  }
  return { ok: false, organisationId, userId, role };
}

/** Whether the caller could do each of these, for deciding what to offer. */
export async function abilities<P extends Permission>(
  permissions: readonly P[],
): Promise<Record<P, boolean>> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const database = await getDatabase();
  const role = await database.withTenant(organisationId, (tx) => roleOf(tx, userId));
  return Object.fromEntries(
    permissions.map((p) => [p, role !== null && can(role, p)]),
  ) as Record<P, boolean>;
}
