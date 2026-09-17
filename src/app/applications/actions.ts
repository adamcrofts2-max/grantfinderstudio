'use server';

import { redirect } from 'next/navigation';
import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { recordAudit } from '@/db/audit';
import { startApplication } from '@/db/workspace';

/**
 * Start an application against an opportunity, then go straight to it.
 *
 * Deliberately possible even when the eligibility verdict is negative: the
 * opportunity page says plainly that the effort would be wasted, and the
 * decision is the applicant's. Blocking it would mean the product overriding
 * a person who may know something about the funder that we do not.
 */
export async function startApplicationAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const opportunityId = String(formData.get('opportunityId') ?? '');
  if (opportunityId === '') return;

  const database = await getDatabase();
  const userId = await requireUserId();
  const { id } = await database.withTenant(organisationId, async (tx) => {
    const started = await startApplication(tx, organisationId, opportunityId);
    await recordAudit(tx, organisationId, {
      userId,
      action: 'application.started',
      entityId: started.id,
      applicationId: started.id,
      metadata: { opportunityId },
    });
    return started;
  });

  // OUTSIDE the transaction. `redirect` works by throwing, so calling it
  // inside `withTenant` would abort the transaction that had just written the
  // application and its audit line — and the throw would look like a database
  // failure on the way out. The same fault, in the same shape, as the
  // `NEXT_REDIRECT` a bare `catch {}` swallowed during onboarding.
  redirect(`/applications/${id}`);
}
