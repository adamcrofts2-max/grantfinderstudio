import { withOperator } from '@/db';
import { readAccounts } from '@/db/platform';

import { requireAdmin } from '../session';
import { AdminShell } from '../AdminShell';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Who has an account.
 *
 * An address and a date. There is no link from a row here to that person's
 * organisation, and there could not be one: `app_operator` holds no grant on
 * `memberships`, `organisations` or anything hanging off them, so the query
 * that would join them fails rather than returning.
 */
export default async function AdminAccountsPage() {
  const session = await requireAdmin();

  let accounts: Awaited<ReturnType<typeof readAccounts>> = [];
  let error: string | null = null;
  try {
    accounts = await withOperator((tx) => readAccounts(tx));
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  return (
    <AdminShell email={session.email} active="accounts">
      <section className="card">
        <h2 className="card-title">Accounts — {accounts.length}</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Sign-ups, newest first. Which organisation each belongs to, and everything that
          organisation has done, is not readable from here.
        </p>

        {error !== null ? (
          <p className="notice notice-caution" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : accounts.length === 0 ? (
          <p className="card-sub" style={{ marginTop: 'var(--s-4)' }}>Nobody has signed up yet.</p>
        ) : (
          <ul className="admin-list" style={{ marginTop: 'var(--s-4)' }}>
            {accounts.map((account) => (
              <li className="admin-list-item" key={account.id}>
                <div style={{ minWidth: 0 }}>
                  <p className="admin-list-title">{account.email}</p>
                  {account.name === null ? null : <p className="hint">{account.name}</p>}
                </div>
                <span className="hint">{account.createdAt.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
