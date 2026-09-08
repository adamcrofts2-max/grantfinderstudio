'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { markSubmitted, unmarkSubmitted } from '@/db/tracker';

/**
 * Record that an application went in.
 *
 * This is what stops its clock, so it has to be one click from the tracker —
 * a tracker that keeps nagging about work already done is one people stop
 * reading, and a tracker people stop reading is worse than none.
 */
export async function markSubmittedAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('applicationId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) => markSubmitted(tx, id));
  revalidatePath('/tracker');
  revalidatePath('/applications');
}

/** Undo a submission recorded by mistake. Restarts the clock. */
export async function unmarkSubmittedAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('applicationId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) => unmarkSubmitted(tx, id));
  revalidatePath('/tracker');
  revalidatePath('/applications');
}
