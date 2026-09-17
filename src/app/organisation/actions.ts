'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { confirmFact, correctFact, recordSelfDeclaredFact } from '@/db/workspace';
import { recordAudit } from '@/db/audit';
import { readableClaim, readSelfDeclaredFact } from '@/domain/provenance/self-declared';
import {
  SELF_DECLARED_FIELDS,
  type FactActionState,
  type SelfDeclaredState,
} from './state';
import { NO_VALUES, readValues } from '@/app/formValues';

/** Mark a fact as checked, so it may ground a funding application. */
export async function confirmFactAction(
  _previous: FactActionState,
  formData: FormData,
): Promise<FactActionState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const factId = String(formData.get('factId') ?? '');
  if (factId === '') return { factId: null, ok: false, message: 'No fact selected.' };

  const database = await getDatabase();
  await database.withTenant(organisationId, async (tx) => {
    await confirmFact(tx, factId, userId);
    // No application: this is the organisation's own record, and folding it
    // into an application's trail would tell a reviewer of one application
    // about work that has nothing to do with it.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'fact.confirmed',
      entityId: factId,
    });
  });
  revalidatePath('/organisation');
  return { factId, ok: true, message: 'Confirmed.' };
}

/**
 * Correct a fact.
 *
 * The original is superseded rather than overwritten, so what the organisation
 * previously believed, and when, is still on the record.
 */
export async function correctFactAction(
  _previous: FactActionState,
  formData: FormData,
): Promise<FactActionState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const factId = String(formData.get('factId') ?? '');
  const value = String(formData.get('value') ?? '').trim();
  if (factId === '' || value === '') {
    return { factId: factId || null, ok: false, message: 'Enter the correct value.' };
  }

  const database = await getDatabase();
  await database.withTenant(organisationId, async (tx) => {
    await correctFact(tx, factId, value, userId);
    // The new value is NOT recorded here. A fact's values are versioned in
    // `facts` — superseded, not overwritten — so the trail would be a second
    // copy of the same claim, and the one place a reviewer could read a
    // corrected turnover the applicant had since corrected again.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'fact.corrected',
      entityId: factId,
    });
  });
  revalidatePath('/organisation');
  return { factId, ok: true, message: 'Corrected and confirmed.' };
}

/**
 * Add a fact by hand.
 *
 * The route that needs no key. Without it, an organisation on a deployment
 * with no model had no way to reach the five confirmed facts the Writer wants
 * — the setup guide asked them to "confirm the facts" and sent them to a page
 * that said everything was checked.
 */
export async function addFactAction(
  _previous: SelfDeclaredState,
  formData: FormData,
): Promise<SelfDeclaredState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();

  const values = readValues(formData, SELF_DECLARED_FIELDS);
  const typed = String(formData.get('customClaim') ?? '').trim();
  const chosen = String(formData.get('claim') ?? '').trim();
  const { fact, errors } = readSelfDeclaredFact({
    // A typed name wins over the list: somebody who filled in the "something
    // else" box has told us the list did not have what they meant.
    claim: typed !== '' ? typed : chosen,
    value: String(formData.get('value') ?? ''),
  });

  if (fact === null) {
    return { saved: false, message: 'Check the highlighted fields.', errors, values };
  }

  try {
    const database = await getDatabase();
    await database.withTenant(organisationId, async (tx) => {
      await recordSelfDeclaredFact(tx, organisationId, userId, fact);
      await recordAudit(tx, organisationId, {
        userId,
        action: 'fact.added',
        metadata: { claim: fact.claim },
      });
    });
  } catch (error) {
    console.error('[grantfinderstudio] could not record a fact:', error);
    return {
      saved: false,
      message: 'That could not be saved. Nothing has been changed.',
      errors: {},
      values,
    };
  }

  revalidatePath('/organisation');
  revalidatePath('/');
  return {
    saved: true,
    message: `Saved. ${readableClaim(fact.claim)} is confirmed and can be used in an application.`,
    errors: {},
    // Cleared on success: ready for the next fact.
    values: NO_VALUES,
  };
}
