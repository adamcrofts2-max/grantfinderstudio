'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createProvider } from '@/ai/providers/anthropic';
import { ANALYST, analystOutputSchema, buildAnalystPrompt } from '@/ai/agents/analyst';
import { runAgent } from '@/ai/run';
import { getDatabase, withAdmin } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import {
  createPastedOpportunity,
  deletePastedOpportunity,
  ensureFunder,
  rejectCriterion,
  verifyCriterion,
} from '@/db/opportunities';

import { isWriterAvailable } from '@/app/drafting';
import type { AddState } from './state';

/** Enough guidance to be worth reading; less than this is a paste that went wrong. */
const MIN_GUIDANCE_CHARS = 200;
const MAX_GUIDANCE_CHARS = 60_000;

/**
 * Read a funder's guidance into a proposed opportunity.
 *
 * Nothing here decides anything. The criteria are stored unverified, which
 * means the eligibility engine cannot see them, which means the opportunity
 * evaluates to `unknown` until a person has been through them. That is the
 * whole design: see `loadCriteria` for the filter that enforces it.
 */
export async function addOpportunityAction(
  _previous: AddState,
  formData: FormData,
): Promise<AddState> {
  const organisationId = await requireOrganisationId();
  const guidance = String(formData.get('guidance') ?? '').trim();
  const sourceUrlRaw = String(formData.get('sourceUrl') ?? '').trim();

  if (guidance.length < MIN_GUIDANCE_CHARS) {
    return {
      ok: false,
      message:
        'Paste the funder’s guidance — the eligibility section and the deadline are the parts that matter.',
    };
  }
  if (guidance.length > MAX_GUIDANCE_CHARS) {
    return { ok: false, message: 'That is more text than we can read in one go.' };
  }

  // Accept a URL only if it is one; a half-typed address in the provenance
  // record is worse than none.
  let sourceUrl: string | null = null;
  if (sourceUrlRaw !== '') {
    try {
      const parsed = new URL(sourceUrlRaw);
      sourceUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return { ok: false, message: 'That does not look like a web address.' };
    }
    if (sourceUrl === null) return { ok: false, message: 'That does not look like a web address.' };
  }

  if (!(await isWriterAvailable())) {
    return {
      ok: false,
      message:
        'Reading a funder’s guidance needs an Anthropic key. Add one in Settings — nothing has been saved.',
    };
  }
  const created = createProvider();
  if (!created.available) return { ok: false, message: created.reason };

  let analysis;
  try {
    const result = await runAgent(
      created.provider,
      ANALYST,
      buildAnalystPrompt(guidance, sourceUrl ?? 'pasted funder guidance'),
    );
    analysis = analystOutputSchema.parse(result.output);
  } catch {
    return {
      ok: false,
      message:
        'We could not make sense of that guidance. Nothing has been saved — try pasting the eligibility and deadline sections.',
    };
  }

  // Funders are shared reference data, so this insert takes the admin path.
  const funderId = await withAdmin((tx) => ensureFunder(tx, analysis.funderName, organisationId));

  const database = await getDatabase();
  let opportunityId: string;
  try {
    const stored = await database.withTenant(organisationId, (tx) =>
      createPastedOpportunity(tx, organisationId, {
        analysis,
        funderId,
        sourceText: guidance,
        sourceUrl,
      }),
    );
    opportunityId = stored.id;
  } catch {
    return { ok: false, message: 'We read the guidance but could not save it. Please try again.' };
  }

  revalidatePath('/');
  redirect(`/opportunities/${opportunityId}/review`);
}

export async function verifyCriterionAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const id = String(formData.get('criterionId') ?? '');
  const opportunityId = String(formData.get('opportunityId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) => verifyCriterion(tx, id, userId));
  revalidatePath(`/opportunities/${opportunityId}/review`);
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function rejectCriterionAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const id = String(formData.get('criterionId') ?? '');
  const opportunityId = String(formData.get('opportunityId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) => rejectCriterion(tx, id, userId));
  revalidatePath(`/opportunities/${opportunityId}/review`);
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function deleteOpportunityAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('opportunityId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) =>
    deletePastedOpportunity(tx, id, organisationId),
  );
  revalidatePath('/');
  redirect('/');
}
