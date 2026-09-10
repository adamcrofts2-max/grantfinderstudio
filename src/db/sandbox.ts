/**
 * An operator's own sandbox.
 *
 * ## The one rule
 *
 * Nothing here takes an organisation id from a caller. Every function derives
 * the organisation from an ADMIN id, and the console only ever passes the id
 * of the admin whose session it just verified. That is the whole security
 * argument, and it is deliberately short enough to hold in one thought:
 *
 * > There is no parameter naming an organisation, so there is nothing to aim.
 *
 * An impersonation tool is dangerous because it takes "which organisation" as
 * an input and then has to be careful about it. This takes "which admin" and
 * has nothing to be careful about. The distinction is not stylistic — it is
 * the difference between a guarantee the schema enforces and a guarantee that
 * depends on every future edit to a permission check.
 *
 * ## What the operator ends up holding
 *
 * An ordinary customer session over an ordinary organisation. Same cookie,
 * same Row-Level Security, same policies. The console gains no read privilege
 * over tenant data by any of this, and `app_operator` still holds no grant on
 * a single tenant table — the sandbox organisation is as invisible to the
 * console as any customer's.
 */

import type { Queryable } from './client.js';

/** Derived, never supplied. Both ids are a pure function of the admin's id. */
export function sandboxUserId(adminId: string): string {
  return `sbxu_${adminId}`;
}

export function sandboxOrganisationId(adminId: string): string {
  return `sbxo_${adminId}`;
}

/**
 * The address on a sandbox account.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so this
 * cannot collide with a real signup and cannot receive mail. It is a label,
 * not a mailbox.
 */
export function sandboxEmail(adminId: string): string {
  return `sandbox+${adminId}@grantfinderstudio.invalid`;
}

export interface SandboxAccount {
  userId: string;
  organisationId: string;
}

/**
 * Create the sandbox account for this admin, or return the existing one.
 *
 * ADMIN scope: `users` is the operator's table, and `app_user` was revoked
 * SELECT on it in 0009.
 *
 * **No password row is ever written.** Sign-in reads `user_passwords`, so an
 * account without one cannot be signed into by anybody, with any password,
 * ever — including whoever learns the address. The only way into a sandbox is
 * the console button, holding an admin session. That is not a policy the code
 * applies; it is an absent row.
 */
export async function ensureSandboxUser(
  tx: Queryable,
  adminId: string,
): Promise<SandboxAccount> {
  const userId = sandboxUserId(adminId);
  await tx.query(
    `INSERT INTO users (id, email, name, sandbox_of_admin)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [userId, sandboxEmail(adminId), 'Sandbox', adminId],
  );
  return { userId, organisationId: sandboxOrganisationId(adminId) };
}

/** Is this account somebody's sandbox? Read where the session is already loaded. */
export async function isSandboxUser(tx: Queryable, userId: string): Promise<boolean> {
  const { rows } = await tx.query<{ sandbox_of_admin: string | null }>(
    'SELECT sandbox_of_admin FROM users WHERE id = $1',
    [userId],
  );
  return (rows[0]?.sandbox_of_admin ?? null) !== null;
}

/**
 * Throw the sandbox away.
 *
 * TENANT path, and it must be: `organisations` is FORCE ROW LEVEL SECURITY, so
 * even the owning role is refused a delete without a tenant context — and the
 * EXISTS guard a defensive instinct wants here could not run anyway, because
 * `app_user` was revoked SELECT on `users` in 0009.
 *
 * It does not need one. The id is a pure function of the admin's id, and the
 * tenant policy means the only row visible in that context is that one
 * organisation. Two independent reasons this cannot touch a customer, neither
 * of them a check somebody could edit out.
 *
 * The organisation goes and everything hanging off it goes by cascade —
 * profile, project, facts, applications, answers, pasted funds. The USER row
 * stays, so the unique index still reserves this admin's sandbox and the next
 * click rebuilds rather than racing.
 *
 * This is what makes the sandbox useful more than once: seeing what a new
 * customer meets is something to do after every change to onboarding, and that
 * needs a way back to nothing.
 */
export async function deleteSandboxOrganisation(tx: Queryable): Promise<void> {
  await tx.query('DELETE FROM organisations WHERE id = current_setting(\'app.organisation_id\', true)');
}
