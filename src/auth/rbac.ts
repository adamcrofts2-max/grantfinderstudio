/**
 * Role-based access control.
 *
 * RBAC answers "may this member do this?" within one organisation. It is not
 * the tenant boundary — that is Row-Level Security, enforced by Postgres. The
 * two are deliberately separate: a bug here narrows or widens what a colleague
 * can do, a bug there would expose another CIC's data entirely.
 *
 * Pure functions over plain data, so the whole matrix is cheap to test.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export type Permission =
  // Organisation
  | 'organisation:read'
  | 'organisation:update'
  | 'organisation:delete'
  // Membership
  | 'member:read'
  | 'member:invite'
  | 'member:remove'
  | 'member:change_role'
  // Content
  | 'project:read'
  | 'project:write'
  | 'document:read'
  | 'document:upload'
  | 'document:delete'
  | 'fact:read'
  | 'fact:confirm'
  | 'evidence:read'
  | 'evidence:write'
  // Applications
  | 'application:read'
  | 'application:write'
  | 'application:submit'
  | 'budget:read'
  | 'budget:write'
  // Account
  | 'billing:manage';

const READ_ONLY: readonly Permission[] = [
  'organisation:read',
  'member:read',
  'project:read',
  'document:read',
  'fact:read',
  'evidence:read',
  'application:read',
  'budget:read',
];

/**
 * Anyone who does the funding work. Editors confirm facts and mark an
 * application submitted, because they are the people doing both.
 *
 * Note that the product never submits anything to a funder itself;
 * 'application:submit' records that a human did.
 */
const EDITOR_ADDITIONS: readonly Permission[] = [
  'project:write',
  'document:upload',
  'fact:confirm',
  'evidence:write',
  'application:write',
  'application:submit',
  'budget:write',
];

/** Managing people and organisation settings, plus destructive content actions. */
const ADMIN_ADDITIONS: readonly Permission[] = [
  'organisation:update',
  'member:invite',
  'member:remove',
  'document:delete',
];

/** Actions that change who controls the account. */
const OWNER_ADDITIONS: readonly Permission[] = [
  'organisation:delete',
  'member:change_role',
  'billing:manage',
];

const VIEWER = new Set<Permission>(READ_ONLY);
const EDITOR = new Set<Permission>([...VIEWER, ...EDITOR_ADDITIONS]);
const ADMIN = new Set<Permission>([...EDITOR, ...ADMIN_ADDITIONS]);
const OWNER = new Set<Permission>([...ADMIN, ...OWNER_ADDITIONS]);

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  viewer: VIEWER,
  editor: EDITOR,
  admin: ADMIN,
  owner: OWNER,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]].toSorted();
}

/** Thrown when an action is attempted without the necessary permission. */
export class AuthorisationError extends Error {
  constructor(
    readonly role: Role,
    readonly permission: Permission,
  ) {
    super(`A ${role} may not ${permission}.`);
    this.name = 'AuthorisationError';
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new AuthorisationError(role, permission);
}

/**
 * Whether a member may change another member's role.
 *
 * Two invariants, both of which exist to stop an organisation locking itself
 * out of its own account:
 *   - only an owner may change roles at all
 *   - the last owner may not be demoted
 */
export function canChangeRole(
  actorRole: Role,
  targetCurrentRole: Role,
  targetNewRole: Role,
  ownerCount: number,
): { allowed: boolean; reason?: string } {
  if (!can(actorRole, 'member:change_role')) {
    return { allowed: false, reason: 'Only an owner can change roles.' };
  }
  if (targetCurrentRole === 'owner' && targetNewRole !== 'owner' && ownerCount <= 1) {
    return {
      allowed: false,
      reason: 'This is the only owner. Make someone else an owner first.',
    };
  }
  return { allowed: true };
}

/**
 * Whether a member may be removed.
 *
 * The same lock-out invariant applies: removing the last owner would leave the
 * organisation with nobody able to administer it.
 */
export function canRemoveMember(
  actorRole: Role,
  targetRole: Role,
  ownerCount: number,
): { allowed: boolean; reason?: string } {
  if (!can(actorRole, 'member:remove')) {
    return { allowed: false, reason: 'You do not have permission to remove members.' };
  }
  if (targetRole === 'owner' && ownerCount <= 1) {
    return {
      allowed: false,
      reason: 'This is the only owner. Make someone else an owner first.',
    };
  }
  if (targetRole === 'owner' && actorRole !== 'owner') {
    return { allowed: false, reason: 'Only an owner can remove another owner.' };
  }
  return { allowed: true };
}
