import { withAdmin } from '@/db';
import { isSandboxUser, sandboxUserId } from '@/db/sandbox';

import { requireAdmin } from '../session';
import { AdminShell } from '../AdminShell';
import { openSandboxAction, resetSandboxAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * See the product the way a customer does.
 *
 * The obvious way to build this — a button that opens somebody's account — is
 * the door every leaked support tool has gone through, and everything
 * dangerous about it lives in the parameter naming WHICH account. So there is
 * no parameter. This opens the one organisation derived from the admin id on
 * your own session, and the console gains no privilege over tenant data by it:
 * what you end up holding is an ordinary customer session, subject to exactly
 * the Row-Level Security a customer is.
 */
export default async function AdminSandboxPage() {
  const session = await requireAdmin();

  let exists = false;
  let error: string | null = null;
  try {
    exists = await withAdmin((tx) => isSandboxUser(tx, sandboxUserId(session.adminId)));
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  return (
    <AdminShell email={session.email} active="sandbox">
      <section className="card">
        <h2 className="card-title">Your sandbox</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          A practice organisation of your own, opened as an ordinary customer session. It is
          the only way to see the product from a customer’s side, because the console
          genuinely cannot read one — <code>app_operator</code> holds no grant on a single
          tenant table, and that is what makes the promise on the sign-in page true.
        </p>

        {error !== null ? (
          <p className="notice notice-caution" role="alert" style={{ marginTop: 'var(--s-3)' }}>
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : null}

        <div className="row" style={{ marginTop: 'var(--s-5)' }}>
          <form action={openSandboxAction}>
            <button className="btn btn-primary" type="submit">
              {exists ? 'Open my sandbox' : 'Create my sandbox and open it'}
            </button>
          </form>
          {exists ? (
            <form action={resetSandboxAction}>
              <button className="btn btn-secondary" type="submit">
                Empty it and start again
              </button>
            </form>
          ) : null}
        </div>

        <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
          It starts empty, which is what a real new customer meets — the setup guide, the
          cold onboarding, every empty state. That is the version worth testing after any
          change to onboarding, and “Empty it and start again” is how you get back to it.
        </p>
      </section>

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">What this is not</h2>
        <dl className="admin-notes">
          <div className="admin-note">
            <dt>It is not a customer’s account.</dt>
            <dd>
              Nothing in this console takes an organisation as an input, here or anywhere.
              The sandbox is derived from your admin id, so there is no field, link or address
              that could be pointed at somebody else’s organisation. If you ever need to help
              a real customer with their own work, the way to build that is for them to grant
              it — time-boxed, logged, and visible to them while it is live.
            </dd>
          </div>
          <div className="admin-note">
            <dt>It is not signed in to by anybody.</dt>
            <dd>
              The sandbox account has no password stored at all, so it cannot be signed into
              from the sign-in page with any password by anyone. The only way in is this
              button, holding an admin session.
            </dd>
          </div>
          <div className="admin-note">
            <dt>It is not counted as a customer.</dt>
            <dd>
              Sandboxes are excluded from the account totals and the account list, so the
              first number you look at after a launch is not your own practice runs.
            </dd>
          </div>
        </dl>
      </section>
    </AdminShell>
  );
}
