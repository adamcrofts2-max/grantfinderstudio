import { withAdmin } from '@/db';
import { checkConfiguration, readEnvironment } from '@/env';

/**
 * Is this deployment able to do anything at all?
 *
 * The sign-up and sign-in PAGES render without touching the database — with no
 * cookie, `readSession` returns null before it opens a connection. So the
 * first submit is the first database call a new deployment ever makes, and
 * before this it was also the first chance for a misconfiguration to surface:
 * as an unhandled exception and a crash page, on the very first thing anyone
 * does.
 *
 * The message shown is deliberately short and free of connection details — an
 * end user is not the operator. The real error goes to the log, where the
 * operator is actually looking.
 */
export async function deploymentProblem(): Promise<string | null> {
  const problems = checkConfiguration(readEnvironment());
  if (problems.length > 0) {
    console.error(
      '[grantfinderstudio] configuration is incomplete:',
      problems.map((p) => `${p.variable}: ${p.problem} — ${p.fix}`).join(' | '),
    );
    return 'This deployment is not configured yet. Open /api/health to see what is missing.';
  }

  try {
    // Also the call that applies any outstanding migrations, so a migration
    // that cannot run is reported here rather than thrown at the browser.
    await withAdmin((tx) => tx.query('SELECT 1'));
    return null;
  } catch (error) {
    console.error('[grantfinderstudio] the database could not be reached or migrated:', error);
    return 'The database is not available. Open /api/health for details.';
  }
}
