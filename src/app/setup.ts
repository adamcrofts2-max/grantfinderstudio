import { cache } from 'react';

import { getDatabase } from '@/db';
import { readSetupCounts } from '@/db/setup';
import { setupProgress, type SetupProgress } from '@/domain/setup/progress';
import { isWriterAvailable } from '@/app/drafting';
import { readSession } from '@/app/session';

/**
 * How far this organisation has got.
 *
 * Memoised for the render pass, because the layout and the page both ask and
 * that must not be two round trips.
 *
 * Returns null when it cannot say — no session, no organisation, or the query
 * failed. Callers treat null as "show everything": guessing that someone is
 * still setting up and hiding the navigation from them would be much worse
 * than showing a finished user a menu they already know.
 */
export const readSetupProgress = cache(async (): Promise<SetupProgress | null> => {
  const session = await readSession();
  if (session === null || session.organisationId === null) return null;

  try {
    // Before the tenant transaction: it takes the operator connection.
    const writerAvailable = await isWriterAvailable();
    const database = await getDatabase();
    const counts = await database.withTenant(session.organisationId, (tx) =>
      readSetupCounts(tx),
    );
    return setupProgress({ ...counts, writerAvailable });
  } catch (error) {
    console.error('[grantfinderstudio] could not read setup progress:', error);
    return null;
  }
});
