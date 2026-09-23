'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase, withAdmin } from '@/db';
import { recordAudit } from '@/db/audit';
import { ensureFunderNamed } from '@/db/catalogue';
import { addHandRule, loadOwnFund, removeRule, updateOwnFund } from '@/db/own-funds';
import { readHandRule } from '@/domain/eligibility/hand-rule';
import { readManualFund } from '@/domain/opportunity/manual';
import { MANUAL_FUND_FIELDS, type ManualFundFormState } from '@/app/manualFundState';
import { readValues } from '@/app/formValues';
import { requireOrganisationId, requireUserId } from '@/app/session';

import { RULE_FIELDS, type RuleFormState } from './state';

/** Every page that shows a fund's details or its verdict. */
function revalidateFund(opportunityId: string): void {
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/edit`);
  revalidatePath('/');
  revalidatePath('/tracker');
}

const NOT_YOURS =
  'That fund is not one of yours, so it cannot be changed here. Nothing has been saved.';

/**
 * Change a fund this organisation added.
 *
 * Bound to the fund's id on the page, rather than read from a hidden field,
 * but trusted no more for it: the update is scoped to this organisation's own
 * rows in the statement, so an id for anybody else's fund changes nothing and
 * says so.
 */
export async function editOwnFundAction(
  opportunityId: string,
  _previous: ManualFundFormState,
  formData: FormData,
): Promise<ManualFundFormState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();

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
    const database = await getDatabase();
    const current = await database.withTenant(organisationId, (tx) =>
      loadOwnFund(tx, opportunityId),
    );
    if (current === null) return { saved: false, message: NOT_YOURS, errors: {}, values };

    // The same funder unless the NAME changed. Re-resolving an unchanged name
    // could move the fund off the exact funder it was attached to — the one
    // whose award history the person was reading when they added it.
    const renamed =
      fund.funderName.trim().toLowerCase() !== current.funderName.trim().toLowerCase();
    // Before the tenant transaction, not inside it: see the guard in withAdmin.
    const funderId = renamed
      ? await withAdmin((tx) =>
          ensureFunderNamed(tx, fund.funderName, `funder_typed_${organisationId}`, organisationId),
        )
      : current.funderId;

    const changed = await database.withTenant(organisationId, async (tx) => {
      const ok = await updateOwnFund(tx, opportunityId, fund, funderId);
      if (ok) {
        await recordAudit(tx, organisationId, {
          userId,
          action: 'opportunity.edited',
          entityId: opportunityId,
          metadata: { funderChanged: renamed },
        });
      }
      return ok;
    });
    if (!changed) return { saved: false, message: NOT_YOURS, errors: {}, values };
  } catch (error) {
    console.error('[grantfinderstudio] could not change a fund:', error);
    return {
      saved: false,
      message: 'That could not be saved. Nothing has been changed.',
      errors: {},
      values,
    };
  }

  revalidateFund(opportunityId);
  return {
    saved: true,
    message: 'Saved.',
    errors: {},
    // Kept, not cleared: after saving an edit the form should still show the
    // fund as it now is, not go blank as the add form does.
    values,
    opportunityId,
  };
}

/** Add an eligibility rule to a fund this organisation added. */
export async function addRuleAction(
  _previous: RuleFormState,
  formData: FormData,
): Promise<RuleFormState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const opportunityId = String(formData.get('opportunityId') ?? '');
  const values = readValues(formData, RULE_FIELDS);

  const { rule, errors } = readHandRule({
    one: (name) => String(formData.get(name) ?? ''),
    all: (name) => formData.getAll(name).map(String),
  });
  if (rule === null) {
    return { saved: false, message: 'Check the highlighted fields.', errors, values };
  }

  let added: string | null = null;
  try {
    const database = await getDatabase();
    added = await database.withTenant(organisationId, async (tx) => {
      const id = await addHandRule(tx, opportunityId, rule, userId);
      if (id !== null) {
        await recordAudit(tx, organisationId, {
          userId,
          action: 'criterion.added',
          entityId: id,
          metadata: { opportunityId, kind: rule.kind },
        });
      }
      return id;
    });
  } catch (error) {
    console.error('[grantfinderstudio] could not add a rule:', error);
    return {
      saved: false,
      message: 'That rule could not be saved. Nothing has been changed.',
      errors: {},
      values,
    };
  }
  if (added === null) {
    return { saved: false, message: NOT_YOURS, errors: {}, values };
  }

  revalidateFund(opportunityId);
  return {
    saved: true,
    message: `Added — “${rule.label}” is now checked against you.`,
    errors: {},
    values: {},
  };
}

/** Stop applying a rule to a fund this organisation added. */
export async function removeRuleAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const criterionId = String(formData.get('criterionId') ?? '');
  const opportunityId = String(formData.get('opportunityId') ?? '');
  const kind = String(formData.get('kind') ?? '');
  if (criterionId === '' || opportunityId === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, async (tx) => {
    const outcome = await removeRule(tx, criterionId, opportunityId, userId);
    if (outcome === null) return;
    await recordAudit(tx, organisationId, {
      userId,
      action: 'criterion.removed',
      entityId: criterionId,
      metadata: { opportunityId, kind, outcome },
    });
  });
  revalidateFund(opportunityId);
}
