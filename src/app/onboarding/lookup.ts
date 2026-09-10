import { withAdmin } from '@/db';
import { readCredentialStatuses, type CredentialStatus } from '@/secrets/store';

/**
 * Can we look a company up at all?
 *
 * Pure, and separated from the fetch on purpose: the real Companies House API
 * is unreachable from the build environment, so the "yes" branch cannot be
 * walked in a browser here. Left as a condition inline it would be a branch
 * nothing ever exercised — which is how the bug below survived in the first
 * place.
 *
 * ## The bug this replaces
 *
 * The onboarding screen used to ask whether `COMPANIES_HOUSE_BASE_URL` was
 * set. That is an optional override for pointing the connector at a test
 * endpoint; it has a real default and nobody sets it in production. So on
 * every correctly-configured deployment the answer was "no lookup", and the
 * one screen whose whole purpose is "we will look you up" offered no way to be
 * looked up. The console's overview tile read "Not configured" for the same
 * reason, while a working key sat in the credential store.
 *
 * A base URL says WHERE to ask. A key says WHETHER we may. Only the second
 * decides whether the feature exists.
 */
export function lookupAvailableFrom(status: CredentialStatus): boolean {
  // Stored is not the same as working — the rule `isWriterAvailable` already
  // applies. A key whose last check failed cannot look anything up, and
  // offering the box anyway spends somebody's first minute on a failure.
  return status.masked !== null && status.lastCheckOk !== false;
}

/**
 * The same question, against the credential store.
 *
 * Fails CLOSED, which is the safe direction here: with no lookup the manual
 * form becomes the page rather than sitting behind a disclosure under a box
 * that cannot work.
 */
export async function lookupIsAvailable(): Promise<boolean> {
  try {
    return await withAdmin(async (tx) => {
      const { companies_house: lookup } = await readCredentialStatuses(tx);
      return lookupAvailableFrom(lookup);
    });
  } catch (error) {
    console.error('[grantfinderstudio] could not read the lookup credential:', error);
    return false;
  }
}
