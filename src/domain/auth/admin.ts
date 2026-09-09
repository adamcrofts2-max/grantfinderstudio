/**
 * Platform admin rules.
 *
 * Pure and zero I/O, like the rest of the domain.
 *
 * An admin is the person who runs the SERVICE, and the rules here are stricter
 * than a customer's in the three places that matter: a longer password,
 * because one admin credential is worth every customer credential put
 * together; a session measured in hours, because a console left open on a
 * laptop is the realistic way this gets taken; and no sign-up at all, because
 * a registration form on an admin console is a back door with a welcome mat.
 */

export const ADMIN_CONSTANTS = {
  /**
   * Longer than a customer's ten. The threat is offline cracking of a stolen
   * hash, and this is the one account where that is worth the extra typing.
   */
  minPasswordLength: 14,
  maxPasswordLength: 200,
  /**
   * Hours, not days. A customer's session lasts a month because losing it
   * costs them their evening; an admin's lasts a working day because keeping
   * it costs everybody.
   */
  sessionHours: 8,
  /** The claim secret is a machine-generated value, so it can demand length. */
  minClaimSecretLength: 24,
} as const;

/** When an admin session created now should stop being accepted. */
export function adminSessionExpiry(
  now: Date,
  hours: number = ADMIN_CONSTANTS.sessionHours,
): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/**
 * What is wrong with a proposed admin password.
 *
 * Every problem at once, as with a customer's: making somebody resubmit to
 * find the next rule is how you get a password with a 1 on the end.
 */
export function adminPasswordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password.length < ADMIN_CONSTANTS.minPasswordLength) {
    problems.push(
      `Use at least ${ADMIN_CONSTANTS.minPasswordLength} characters. This one account can see how the whole service is running.`,
    );
  }
  if (password.length > ADMIN_CONSTANTS.maxPasswordLength) {
    problems.push(`Keep it under ${ADMIN_CONSTANTS.maxPasswordLength} characters.`);
  }
  if (password.trim().length === 0) {
    problems.push('A password of only spaces is not a password.');
  }
  const address = email.trim().toLowerCase();
  if (address !== '' && password.toLowerCase().includes(address)) {
    problems.push('Do not put the email address in the password.');
  }
  return problems;
}

export interface ClaimContext {
  /** How many admin accounts already exist. */
  existingAdmins: number;
  /** Whether ADMIN_CLAIM_SECRET is configured at all. */
  secretConfigured: boolean;
}

export type ClaimAvailability =
  | { open: true }
  | { open: false; reason: 'already-claimed' | 'no-secret' };

/**
 * May the first admin be claimed right now?
 *
 * Two conditions, both necessary.
 *
 * The table must be EMPTY. This is what makes the claim a one-time door rather
 * than a standing registration form: once an admin exists the route is closed
 * for the life of the deployment, and closing it needs no configuration change
 * anybody could forget.
 *
 * And a secret must be configured. Without it the door would be open to
 * whoever reached a freshly deployed instance first — the operator is racing
 * strangers for their own console, and losing that race silently is the worst
 * possible outcome. With it, the window is open only to somebody holding a
 * value that exists nowhere but the hosting environment.
 */
export function claimAvailability(context: ClaimContext): ClaimAvailability {
  if (context.existingAdmins > 0) return { open: false, reason: 'already-claimed' };
  if (!context.secretConfigured) return { open: false, reason: 'no-secret' };
  return { open: true };
}

/**
 * Is this claim secret usable as one?
 *
 * A short secret is a guessable secret, and this one guards the only door into
 * the console. Rejecting it at configuration time is better than discovering
 * during an incident that it was `admin`.
 */
export function claimSecretProblem(secret: string | null): string | null {
  if (secret === null) return null;
  if (secret.trim().length < ADMIN_CONSTANTS.minClaimSecretLength) {
    return `ADMIN_CLAIM_SECRET is shorter than ${ADMIN_CONSTANTS.minClaimSecretLength} characters, which is guessable. Generate one with: openssl rand -base64 32`;
  }
  return null;
}

export interface RosterChange {
  /** The admin asking for the change. */
  actorId: string;
  /** The admin the change is aimed at. */
  targetId: string;
  /** Whether that admin is already stood down. */
  targetDisabled: boolean;
  /** How many admins can currently sign in, the target included if enabled. */
  enabledAdmins: number;
}

/**
 * Why an admin may not be stood down, or null if they may.
 *
 * Two refusals, and both exist to stop the console locking itself.
 *
 * The LAST enabled admin cannot be stood down, because the claim route is open
 * only while the table is empty (see `claimAvailability`). Disabling the only
 * admin would therefore not be a reversible administrative act; it would end
 * access to the console for the life of the deployment, recoverable only with
 * a hand-written UPDATE against production. A confirmation dialog is not
 * enough for a mistake that expensive.
 *
 * And nobody may stand THEMSELVES down. Revocation is something done to an
 * account by somebody who still holds the console; a self-revocation is a
 * one-click lockout with no undo the person can reach, since their own session
 * stops working the moment the row is written. Somebody leaving asks the other
 * admin, which is also the only version that leaves a trace of who decided it.
 */
export function standDownRefusal(change: RosterChange): string | null {
  if (change.targetDisabled) return 'That admin has already been stood down.';
  if (change.actorId === change.targetId) {
    return 'You cannot stand yourself down. Another admin has to do it, so that the console is never closed by a single click.';
  }
  if (change.enabledAdmins <= 1) {
    return 'This is the last admin who can sign in. Add another before standing this one down — with none left, the console cannot be opened again.';
  }
  return null;
}

/** Why an admin may not be brought back, or null if they may. */
export function restoreRefusal(change: Pick<RosterChange, 'targetDisabled'>): string | null {
  if (!change.targetDisabled) return 'That admin can already sign in.';
  return null;
}
