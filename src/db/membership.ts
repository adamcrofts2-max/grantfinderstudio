/**
 * What role somebody holds in the organisation. TENANT path.
 *
 * The first reader of `memberships.role` in the product. `src/auth/rbac.ts`
 * has held a complete permission matrix since the start, and nothing ever
 * consulted it — every check anywhere was "are you signed in to this
 * organisation", which made a viewer an owner in all but name. That was
 * harmless only because onboarding makes exactly one member, always the
 * owner, and there is no invite yet. See the September 2026 security review.
 *
 * Row-level security scopes the lookup to the organisation in context, so
 * this cannot report somebody's role in a different one.
 */

import type { Role } from '../auth/rbac.js';
import type { Queryable } from './client.js';

const ROLES = new Set<string>(['owner', 'admin', 'editor', 'viewer']);

export async function roleOf(tx: Queryable, userId: string): Promise<Role | null> {
  const { rows } = await tx.query<{ role: string }>(
    'SELECT role::text AS role FROM memberships WHERE user_id = $1',
    [userId],
  );
  const role = rows[0]?.role;
  // Unknown to this version, or absent: no role, which denies. Never a
  // default, because a default is a grant nobody decided on.
  return role !== undefined && ROLES.has(role) ? (role as Role) : null;
}
