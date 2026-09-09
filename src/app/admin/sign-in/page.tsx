import { redirect } from 'next/navigation';

import { withAdmin } from '@/db';
import { countAdmins } from '@/db/admin';
import { claimAvailability } from '@/domain/auth/admin';
import { readEnvironment } from '@/env';

import { readAdminSession } from '../session';
import { AdminSignIn } from './AdminSignIn';
import { AdminClaim } from './AdminClaim';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Console — Grant Finder Studio',
  // A console is not something to find in a search result.
  robots: { index: false, follow: false },
};

/**
 * The only door into the console.
 *
 * It shows one of two things, and which one is not a preference: while no
 * admin exists it offers the claim, and the moment one does it offers sign-in
 * and never offers the claim again. There is no third state and no
 * registration form.
 */
export default async function AdminSignInPage() {
  if ((await readAdminSession()) !== null) redirect('/admin');

  let existingAdmins = 0;
  let reachable = true;
  try {
    existingAdmins = await withAdmin((tx) => countAdmins(tx));
  } catch (error) {
    console.error('[grantfinderstudio] could not count admins:', error);
    reachable = false;
  }

  const secretConfigured = readEnvironment().adminClaimSecret !== null;
  const availability = claimAvailability({ existingAdmins, secretConfigured });

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <p className="eyebrow">Grant Finder Studio</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Console
        </h1>

        {!reachable ? (
          <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }} role="alert">
            <span aria-hidden="true">⚠</span>
            <span>
              The database is not reachable, so nobody can sign in. Open{' '}
              <a href="/api/health">/api/health</a> for what is wrong with it.
            </span>
          </p>
        ) : availability.open ? (
          <AdminClaim />
        ) : (
          <>
            <p className="page-sub">
              For whoever runs this service. It shows how the deployment is doing and what is
              in the shared catalogue — never any organisation’s own work.
            </p>
            <AdminSignIn />
            {availability.reason === 'no-secret' && existingAdmins === 0 ? (
              <p className="notice notice-caution" style={{ marginTop: 'var(--s-5)' }}>
                <span aria-hidden="true">⚠</span>
                <span>
                  No admin exists yet and <code>ADMIN_CLAIM_SECRET</code> is not set, so there
                  is no way in. Set it in the hosting environment, redeploy, and this page will
                  offer to create the first admin.
                </span>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
