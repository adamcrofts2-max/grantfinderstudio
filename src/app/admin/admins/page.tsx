import { withAdmin } from '@/db';
import { listAdmins } from '@/db/admin';

import { requireAdmin } from '../session';
import { AdminShell } from '../AdminShell';
import { Roster, type AdminRowView } from './Roster';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Who runs the service.
 *
 * `admin_accounts` is granted to no role, `app_operator` included, so this is
 * the one console page that reads through `withAdmin` rather than
 * `withOperator`. That is deliberate: the table holds password hashes, and a
 * role able to read them for the sake of listing email addresses would be a
 * worse trade than raising privilege for one query.
 */
export default async function AdminRosterPage() {
  const session = await requireAdmin();

  let admins: AdminRowView[] = [];
  let error: string | null = null;
  try {
    const rows = await withAdmin((tx) => listAdmins(tx));
    admins = rows.map((row) => ({
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString().slice(0, 10),
      lastSignedInAt: row.lastSignedInAt?.toISOString().slice(0, 10) ?? null,
      disabled: row.disabledAt !== null,
      isYou: row.id === session.adminId,
    }));
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  return (
    <AdminShell email={session.email} active="admins">
      {error !== null ? (
        <section className="card">
          <h2 className="card-title">Admins</h2>
          <p className="notice notice-caution" role="alert" style={{ marginTop: 'var(--s-3)' }}>
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        </section>
      ) : (
        <Roster admins={admins} />
      )}
    </AdminShell>
  );
}
