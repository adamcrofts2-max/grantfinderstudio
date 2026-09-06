import { describe, expect, it } from 'vitest';
import {
  assertCan,
  AuthorisationError,
  can,
  canChangeRole,
  canRemoveMember,
  permissionsFor,
  type Permission,
  type Role,
} from './rbac.js';

const ROLES: Role[] = ['viewer', 'editor', 'admin', 'owner'];

describe('role hierarchy', () => {
  it('gives each role everything the role below it has', () => {
    for (let i = 1; i < ROLES.length; i++) {
      const lower = permissionsFor(ROLES[i - 1]!);
      const higher = permissionsFor(ROLES[i]!);
      for (const permission of lower) {
        expect(higher, `${ROLES[i]} is missing ${permission}`).toContain(permission);
      }
    }
  });

  it('gives each role strictly more than the one below it', () => {
    for (let i = 1; i < ROLES.length; i++) {
      expect(permissionsFor(ROLES[i]!).length).toBeGreaterThan(
        permissionsFor(ROLES[i - 1]!).length,
      );
    }
  });
});

describe('viewer', () => {
  it('can read everything', () => {
    const reads: Permission[] = [
      'organisation:read', 'member:read', 'project:read', 'document:read',
      'fact:read', 'evidence:read', 'application:read', 'budget:read',
    ];
    for (const p of reads) expect(can('viewer', p)).toBe(true);
  });

  it('can write nothing', () => {
    const writes: Permission[] = [
      'project:write', 'document:upload', 'fact:confirm', 'evidence:write',
      'application:write', 'application:submit', 'budget:write',
    ];
    for (const p of writes) expect(can('viewer', p)).toBe(false);
  });
});

describe('editor', () => {
  it('can do the funding work', () => {
    const work: Permission[] = [
      'project:write', 'document:upload', 'fact:confirm', 'evidence:write',
      'application:write', 'application:submit', 'budget:write',
    ];
    for (const p of work) expect(can('editor', p)).toBe(true);
  });

  it('cannot manage people, settings or destructive actions', () => {
    const restricted: Permission[] = [
      'member:invite', 'member:remove', 'member:change_role',
      'organisation:update', 'organisation:delete', 'document:delete',
      'billing:manage',
    ];
    for (const p of restricted) expect(can('editor', p)).toBe(false);
  });
});

describe('admin', () => {
  it('can manage members and organisation settings', () => {
    for (const p of ['member:invite', 'member:remove', 'organisation:update', 'document:delete'] as Permission[]) {
      expect(can('admin', p)).toBe(true);
    }
  });

  it('cannot change who controls the account', () => {
    for (const p of ['organisation:delete', 'member:change_role', 'billing:manage'] as Permission[]) {
      expect(can('admin', p)).toBe(false);
    }
  });
});

describe('owner', () => {
  it('can do everything an admin can, and more', () => {
    for (const p of ['organisation:delete', 'member:change_role', 'billing:manage'] as Permission[]) {
      expect(can('owner', p)).toBe(true);
    }
  });
});

describe('assertCan', () => {
  it('passes silently when permitted', () => {
    expect(() => assertCan('owner', 'organisation:delete')).not.toThrow();
  });

  it('throws a typed error naming the role and permission', () => {
    try {
      assertCan('viewer', 'application:write');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorisationError);
      const e = error as AuthorisationError;
      expect(e.role).toBe('viewer');
      expect(e.permission).toBe('application:write');
      expect(e.message).toBe('A viewer may not application:write.');
    }
  });
});

describe('canChangeRole', () => {
  it('lets an owner promote an editor', () => {
    expect(canChangeRole('owner', 'editor', 'admin', 1).allowed).toBe(true);
  });

  it('refuses anyone who is not an owner', () => {
    const r = canChangeRole('admin', 'editor', 'viewer', 2);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Only an owner');
  });

  it('refuses to demote the last owner', () => {
    const r = canChangeRole('owner', 'owner', 'admin', 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('only owner');
  });

  it('allows demoting an owner when another remains', () => {
    expect(canChangeRole('owner', 'owner', 'admin', 2).allowed).toBe(true);
  });

  it('allows a no-op change on the last owner', () => {
    expect(canChangeRole('owner', 'owner', 'owner', 1).allowed).toBe(true);
  });
});

describe('canRemoveMember', () => {
  it('lets an admin remove an editor', () => {
    expect(canRemoveMember('admin', 'editor', 1).allowed).toBe(true);
  });

  it('refuses an editor', () => {
    const r = canRemoveMember('editor', 'viewer', 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('do not have permission');
  });

  it('refuses to remove the last owner', () => {
    const r = canRemoveMember('owner', 'owner', 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('only owner');
  });

  it('stops an admin removing an owner even when others remain', () => {
    const r = canRemoveMember('admin', 'owner', 3);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Only an owner');
  });

  it('lets an owner remove another owner when one remains', () => {
    expect(canRemoveMember('owner', 'owner', 2).allowed).toBe(true);
  });
});
