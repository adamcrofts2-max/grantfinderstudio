'use server';

import { redirect } from 'next/navigation';
import { getDatabase } from '@/db';
import { startApplication } from '@/db/workspace';
import { DEMO_ORG_ID } from '@/demo/seed';

/**
 * Start an application against an opportunity, then go straight to it.
 *
 * Deliberately possible even when the eligibility verdict is negative: the
 * opportunity page says plainly that the effort would be wasted, and the
 * decision is the applicant's. Blocking it would mean the product overriding
 * a person who may know something about the funder that we do not.
 */
export async function startApplicationAction(formData: FormData): Promise<void> {
  const opportunityId = String(formData.get('opportunityId') ?? '');
  if (opportunityId === '') return;

  const database = await getDatabase();
  const { id } = await database.withTenant(DEMO_ORG_ID, (tx) =>
    startApplication(tx, DEMO_ORG_ID, opportunityId),
  );

  redirect(`/applications/${id}`);
}
