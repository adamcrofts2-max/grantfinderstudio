'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { withAdmin } from '@/db';
import {
  countEnabledAdmins,
  deleteOtherAdminSessions,
  disableAdmin,
  enableAdmin,
  findAdminById,
  insertAdmin,
  readAdminPassword,
  setAdminPassword,
} from '@/db/admin';
import { hashPassword, verifyPassword } from '@/auth/password';
import { isPlausibleEmail, normaliseEmail } from '@/domain/auth/account';
import {
  adminPasswordProblems,
  restoreRefusal,
  standDownRefusal,
} from '@/domain/auth/admin';

import { requireAdmin } from '../session';
import { EMPTY_ROSTER, type RosterState } from './state';

/** Every outcome is stamped, so the screen can tell which one is the latest. */
const now = (): number => Date.now();

/**
 * Who runs the console, and who used to.
 *
 * ADMIN scope throughout — `admin_accounts` is granted to no role at all, not
 * even `app_operator` (0009), because a role that can read password hashes is
 * not a role worth having for a page that only lists email addresses.
 *
 * `requireAdmin` opens every action. A server action is a public endpoint: the
 * page rendering behind a guard does not guard the action, and these three
 * create an admin, revoke one, and change a password.
 */

/** Add somebody to the console. */
export async function addAdminAction(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  await requireAdmin();

  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');

  const problems = adminPasswordProblems(password, email);
  if (!isPlausibleEmail(email)) {
    problems.unshift('That does not look like an email address.');
  }
  if (problems.length > 0) {
    return {
      ok: false,
      message: 'Nothing has been created.',
      problems,
      adminId: null,
      at: now(),
      email,
    };
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const created = await withAdmin((tx) => insertAdmin(tx, { id, email, passwordHash }));
  if (!created) {
    return {
      ok: false,
      message:
        'There is already an admin with that address. If they were stood down, bring them back rather than creating a second account.',
      problems: [],
      adminId: null,
      at: now(),
      email,
    };
  }

  revalidatePath('/admin/admins');
  return {
    ok: true,
    message: `${email} can now sign in. Hand them the password in person or through a password manager — not in an email, which is the one place a console password should never sit.`,
    problems: [],
    adminId: null,
    at: now(),
    email: '',
  };
}

/** Take somebody's console access away, now rather than at session expiry. */
export async function standDownAdminAction(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  const session = await requireAdmin();
  const targetId = String(formData.get('adminId') ?? '');

  const outcome = await withAdmin(async (tx) => {
    const target = await findAdminById(tx, targetId);
    if (target === null) return 'No such admin.';
    const refusal = standDownRefusal({
      actorId: session.adminId,
      targetId: target.id,
      targetDisabled: target.disabledAt !== null,
      enabledAdmins: await countEnabledAdmins(tx),
    });
    if (refusal !== null) return refusal;
    await disableAdmin(tx, target.id);
    return null;
  });

  if (outcome !== null) {
    return { ...EMPTY_ROSTER, ok: false, message: outcome, adminId: targetId, at: now() };
  }

  revalidatePath('/admin/admins');
  return {
    ...EMPTY_ROSTER,
    message: 'Stood down. Every session they held has been deleted.',
    adminId: targetId,
    at: now(),
  };
}

/** Give it back. */
export async function restoreAdminAction(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  await requireAdmin();
  const targetId = String(formData.get('adminId') ?? '');

  const outcome = await withAdmin(async (tx) => {
    const target = await findAdminById(tx, targetId);
    if (target === null) return 'No such admin.';
    const refusal = restoreRefusal({ targetDisabled: target.disabledAt !== null });
    if (refusal !== null) return refusal;
    await enableAdmin(tx, target.id);
    return null;
  });

  if (outcome !== null) {
    return { ...EMPTY_ROSTER, ok: false, message: outcome, adminId: targetId, at: now() };
  }

  revalidatePath('/admin/admins');
  return {
    ...EMPTY_ROSTER,
    message: 'They can sign in again. Their old sessions stay gone.',
    adminId: targetId,
    at: now(),
  };
}

/**
 * Change your own console password.
 *
 * The current one is required even though the session already proves who you
 * are: a console left open on an unlocked laptop should not be a way to lock
 * its owner out of it. Every other session for this account is deleted
 * afterwards — the usual reason to change a password is that somebody else may
 * have had it, and leaving their session alive would make the change
 * cosmetic.
 */
export async function changeAdminPasswordAction(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  const session = await requireAdmin();
  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');

  const stored = await withAdmin((tx) => readAdminPassword(tx, session.adminId));
  if (stored === null || !(await verifyPassword(current, stored))) {
    return {
      ...EMPTY_ROSTER,
      ok: false,
      message: 'That is not your current password.',
      adminId: 'self',
      at: now(),
    };
  }

  const problems = adminPasswordProblems(next, session.email);
  if (next === current) problems.push('That is the password you already have.');
  if (problems.length > 0) {
    return {
      ok: false,
      message: 'Your password has not changed.',
      problems,
      adminId: 'self',
      at: now(),
      email: '',
    };
  }

  const hash = await hashPassword(next);
  await withAdmin(async (tx) => {
    await setAdminPassword(tx, session.adminId, hash);
    await deleteOtherAdminSessions(tx, session.adminId, session.tokenHash);
  });

  return {
    ...EMPTY_ROSTER,
    message:
      'Changed. Anywhere else you were signed in to the console has been signed out; this browser stays.',
    adminId: 'self',
    at: now(),
  };
}
