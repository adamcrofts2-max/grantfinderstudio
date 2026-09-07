'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db';
import { confirmFact, correctFact } from '@/db/workspace';
import { DEMO_ORG_ID, DEMO_USER_ID } from '@/demo/seed';
import { type FactActionState } from './state';

/** Mark a fact as checked, so it may ground a funding application. */
export async function confirmFactAction(
  _previous: FactActionState,
  formData: FormData,
): Promise<FactActionState> {
  const factId = String(formData.get('factId') ?? '');
  if (factId === '') return { factId: null, ok: false, message: 'No fact selected.' };

  const database = await getDatabase();
  await database.withTenant(DEMO_ORG_ID, (tx) => confirmFact(tx, factId, DEMO_USER_ID));
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
  const factId = String(formData.get('factId') ?? '');
  const value = String(formData.get('value') ?? '').trim();
  if (factId === '' || value === '') {
    return { factId: factId || null, ok: false, message: 'Enter the correct value.' };
  }

  const database = await getDatabase();
  await database.withTenant(DEMO_ORG_ID, (tx) => correctFact(tx, factId, value, DEMO_USER_ID));
  revalidatePath('/organisation');
  return { factId, ok: true, message: 'Corrected and confirmed.' };
}
