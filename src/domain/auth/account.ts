/**
 * Account rules.
 *
 * Pure and zero I/O, like the rest of the domain. Everything here is a
 * decision about what we will accept, kept away from the machinery that
 * hashes, stores or transmits it — so the rules can be read, argued with and
 * tested without a database.
 */

export const ACCOUNT_CONSTANTS = {
  /**
   * NIST SP 800-63B: length is the control that matters, composition rules
   * ("must contain a number") are not. They push people towards Passw0rd! and
   * towards writing it down. So: a real minimum, a maximum only to bound the
   * work factor, and no character classes.
   */
  minPasswordLength: 10,
  /**
   * scrypt hashes its input at any length, but an unbounded field is a cheap
   * way to make the server do expensive work.
   */
  maxPasswordLength: 200,
  maxEmailLength: 254,
  /** How long a session lasts without being used. */
  sessionDays: 30,
} as const;

/**
 * Fold an address to the form we store and compare.
 *
 * Case-insensitive because every mail provider treats it that way, and
 * because someone who signed up as Jo@ and returns as jo@ is the same person
 * having a bad morning. The local part is NOT otherwise touched: stripping
 * dots or +tags is a guess about one provider's routing, and guessing wrong
 * merges two real accounts.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Is this shaped like an address we can send to?
 *
 * Deliberately loose. The only real test of an address is delivering to it,
 * and every clever regex here rejects somebody's genuine mailbox. This catches
 * the typo and the empty box, and nothing more.
 */
export function isPlausibleEmail(email: string): boolean {
  if (email.length === 0 || email.length > ACCOUNT_CONSTANTS.maxEmailLength) return false;
  if (/\s/u.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  return true;
}

/**
 * What is wrong with this password, in words the person can act on.
 *
 * Returns every problem at once rather than the first: making someone resubmit
 * to discover the next rule is how you get people typing their old password
 * with a 1 on the end.
 */
export function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password.length < ACCOUNT_CONSTANTS.minPasswordLength) {
    problems.push(
      `Use at least ${ACCOUNT_CONSTANTS.minPasswordLength} characters. Length is what makes a password hard to guess — a short one with a symbol in it is not safer.`,
    );
  }
  if (password.length > ACCOUNT_CONSTANTS.maxPasswordLength) {
    problems.push(`Keep it under ${ACCOUNT_CONSTANTS.maxPasswordLength} characters.`);
  }
  if (password.trim().length === 0) {
    problems.push('A password of only spaces is not a password.');
  }
  const normalised = normaliseEmail(email);
  if (normalised !== '' && password.toLowerCase().includes(normalised)) {
    problems.push('Do not put your email address in your password.');
  }
  return problems;
}

/** When a session created now should stop being accepted. */
export function sessionExpiry(now: Date, days: number = ACCOUNT_CONSTANTS.sessionDays): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Expiry is inclusive of the instant itself: a session expiring now is done. */
export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
