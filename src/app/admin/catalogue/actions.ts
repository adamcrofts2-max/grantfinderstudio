'use server';

import { revalidatePath } from 'next/cache';

import { withAdmin } from '@/db';
import { deleteSharedFund, ensureFunderNamed, insertManualFund } from '@/db/catalogue';
import { readManualFund } from '@/domain/opportunity/manual';
import { MANUAL_FUND_FIELDS } from '@/app/ManualFundForm';
import { NO_VALUES, readValues } from '@/app/formValues';

import { requireAdmin } from '../session';
import type { CatalogueFormState } from './state';

/**
 * Curating the shared catalogue.
 *
 * On the OWNER connection, not the operator's: `app_operator` has SELECT on
 * `opportunities` and nothing more, so a stolen console session can read what
 * every tenant sees but cannot rewrite it. Raising a privilege for the two
 * statements that need it is a smaller surface than holding it all the time.
 *
 * `requireAdmin` runs first in both. A server action is a public endpoint —
 * the page rendering behind a guard does not guard the action.
 */

export async function addSharedFundAction(
  _previous: CatalogueFormState,
  formData: FormData,
): Promise<CatalogueFormState> {
  await requireAdmin();

  const read = (name: string): string => String(formData.get(name) ?? '');
  const values = readValues(formData, MANUAL_FUND_FIELDS);
  const { fund, errors } = readManualFund({
    funderName: read('funderName'),
    title: read('title'),
    summary: read('summary'),
    sourceUrl: read('sourceUrl'),
    jurisdiction: read('jurisdiction'),
    minAmountGbp: read('minAmountGbp'),
    maxAmountGbp: read('maxAmountGbp'),
    deadline: read('deadline'),
    deadlineKind: read('deadlineKind'),
  });

  if (fund === null) {
    return { saved: false, message: 'Check the highlighted fields.', errors, values };
  }

  try {
    // NULL organisation: that is what makes it shared.
    await withAdmin(async (tx) => {
      const funderId = await ensureFunderNamed(tx, fund.funderName, 'funder_shared');
      return insertManualFund(tx, fund, funderId, null);
    });
  } catch (error) {
    console.error('[grantfinderstudio] could not add a shared fund:', error);
    return {
      saved: false,
      message: 'That could not be saved. Nothing has been added.',
      errors: {},
      values,
    };
  }

  revalidatePath('/admin/catalogue');
  revalidatePath('/admin');
  revalidatePath('/');
  return {
    saved: true,
    message: `Added. Every organisation on this deployment can now see ${fund.title}.`,
    errors: {},
    values: NO_VALUES,
  };
}

export async function removeSharedFundAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  await withAdmin((tx) => deleteSharedFund(tx, id));
  revalidatePath('/admin/catalogue');
  revalidatePath('/admin');
  revalidatePath('/');
}
