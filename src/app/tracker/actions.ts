'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { recordAudit } from '@/db/audit';
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
  const userId = await requireUserId();
  await database.withTenant(organisationId, async (tx) => {
    await markSubmitted(tx, id);
    await recordAudit(tx, organisationId, {
      userId,
      action: 'application.submitted',
      entityId: id,
      applicationId: id,
    });
  });
  revalidatePath('/tracker');
  revalidatePath('/applications');
}

/** Undo a submission recorded by mistake. Restarts the clock. */
export async function unmarkSubmittedAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('applicationId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  const userId = await requireUserId();
  await database.withTenant(organisationId, async (tx) => {
    await unmarkSubmitted(tx, id);
    await recordAudit(tx, organisationId, {
      userId,
      action: 'application.unsubmitted',
      entityId: id,
      applicationId: id,
    });
  });
  revalidatePath('/tracker');
  revalidatePath('/applications');
}
