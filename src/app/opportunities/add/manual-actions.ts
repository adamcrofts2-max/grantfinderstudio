'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase, withAdmin } from '@/db';
import { ensureFunderNamed, insertManualFund } from '@/db/catalogue';
import { readManualFund } from '@/domain/opportunity/manual';
import { requireOrganisationId } from '@/app/session';
import { MANUAL_FUND_FIELDS, type ManualFundFormState } from '@/app/ManualFundForm';
import { NO_VALUES, readValues } from '@/app/formValues';

/**
 * A fund a CIC typed in themselves.
 *
 * The tenant path, so it carries their organisation id and the policy in 0004
 * keeps it to them: nobody else on the deployment sees a fund somebody added
 * for their own list, which is the same promise the pasted-guidance route
 * makes.
 *
 * No model, no key, no waiting. This is what the product does when there is no
 * Anthropic key on the deployment, and it is not a lesser version of the
 * feature so much as a different one: reading guidance proposes eligibility
 * rules, and typing a fund in deliberately proposes none. An unassessed fund
 * that shows its deadline, its size and a link is worth having; an invented
 * rule is not.
 */
export async function addOwnFundAction(
  _previous: ManualFundFormState,
  formData: FormData,
): Promise<ManualFundFormState> {
  const organisationId = await requireOrganisationId();

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
    // Funders are shared reference data: the tenant role reads them and does
    // not write them, so this one insert takes the operator path, as the
    // pasted-guidance route does.
    const funderId = await withAdmin((tx) =>
      ensureFunderNamed(tx, fund.funderName, `funder_typed_${organisationId}`),
    );
    const database = await getDatabase();
    await database.withTenant(organisationId, (tx) =>
      insertManualFund(tx, fund, funderId, organisationId),
    );
  } catch (error) {
    console.error('[grantfinderstudio] could not add a fund by hand:', error);
    return {
      saved: false,
      message: 'That could not be saved. Nothing has been added.',
      errors: {},
      values,
    };
  }

  revalidatePath('/');
  revalidatePath('/tracker');
  revalidatePath('/opportunities/add');
  return {
    saved: true,
    message: `Added. ${fund.title} is on your list, and only yours.`,
    errors: {},
    // Cleared on success: ready for the next fund.
    values: NO_VALUES,
  };
}
