'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createProvider } from '@/ai/providers/anthropic';
import { ANALYST, analystOutputSchema, buildAnalystPrompt } from '@/ai/agents/analyst';
import { runAgent } from '@/ai/run';
import { AiRefusalError, AiSchemaError } from '@/ai/types';
import { findFunderById } from '@/db/catalogue';
import { findApplicationForOpportunity } from '@/db/workspace';
import { getDatabase, withAdmin } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { recordAudit } from '@/db/audit';
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
  const userId = await requireUserId();
  const guidance = String(formData.get('guidance') ?? '').trim();
  const sourceUrlRaw = String(formData.get('sourceUrl') ?? '').trim();
  const pickedFunderId = String(formData.get('funderId') ?? '').trim();

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
  } catch (error) {
    // SAID, not swallowed. This used to be a bare `catch`, so a dead key, an
    // outage and a malformed reply all reached the applicant as "we could
    // not make sense of that guidance" — blaming their paste — and reached
    // the operator as nothing at all. The name and message only: they carry
    // schema paths and status codes, never the guidance itself.
    console.error(
      '[grantfinderstudio] reading pasted guidance failed:',
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    if (error instanceof AiSchemaError || error instanceof AiRefusalError) {
      return {
        ok: false,
        message:
          'We could not make sense of that guidance. Nothing has been saved — try pasting the eligibility and deadline sections.',
      };
    }
    return {
      ok: false,
      message:
        'The service that reads guidance did not answer. Nothing has been saved — your text is still here, so try again in a minute, or type the fund in yourself below.',
    };
  }

  // The funder they came from, when they came from one — so the fund joins
  // THAT award history, as the page promised, instead of whichever row the
  // model's spelling of the name happens to match. Looked up with ownership,
  // because the owner connection bypasses row-level security and the id
  // arrived from a form. Otherwise the name the analyst read, as before.
  const funderId = await withAdmin(async (tx) => {
    if (pickedFunderId !== '') {
      const picked = await findFunderById(tx, pickedFunderId, organisationId);
      if (picked !== null) return picked.id;
    }
    return ensureFunder(tx, analysis.funderName, organisationId);
  });

  const database = await getDatabase();
  let opportunityId: string;
  try {
    const stored = await database.withTenant(organisationId, async (tx) => {
      const opportunity = await createPastedOpportunity(tx, organisationId, {
        analysis,
        funderId,
        sourceText: guidance,
        sourceUrl,
      });
      await recordAudit(tx, organisationId, {
        userId,
        action: 'opportunity.added',
        entityId: opportunity.id,
        metadata: {
          funderName: analysis.funderName,
          criteria: analysis.criteria.length,
          fromUrl: sourceUrl !== null,
        },
      });
      return opportunity;
    });
    opportunityId = stored.id;
  } catch (error) {
    // Logged for the same reason as the read above: a failure after the
    // model has already been paid for is the one an operator most needs to
    // see, and a bare catch showed them nothing.
    console.error(
      '[grantfinderstudio] storing a read fund failed:',
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
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
  await database.withTenant(organisationId, async (tx) => {
    await verifyCriterion(tx, id, userId);
    // A verified criterion is the thing the eligibility engine and the budget
    // check both run on, so who verified it and when is the provenance behind
    // every verdict downstream of it.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'criterion.verified',
      entityId: id,
      metadata: { opportunityId },
    });
  });
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
  await database.withTenant(organisationId, async (tx) => {
    await rejectCriterion(tx, id, userId);
    await recordAudit(tx, organisationId, {
      userId,
      action: 'criterion.rejected',
      entityId: id,
      metadata: { opportunityId },
    });
  });
  revalidatePath(`/opportunities/${opportunityId}/review`);
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function deleteOpportunityAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const id = String(formData.get('opportunityId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  const removed = await database.withTenant(organisationId, async (tx) => {
    // The application goes with the fund (it cascades), and its answers are
    // the person's own writing. The form asks for that to be ticked; this is
    // where the tick is actually required, because a form is only a request.
    const application = await findApplicationForOpportunity(tx, id);
    if (application !== null && formData.get('alsoApplication') !== 'yes') return false;
    // BEFORE the delete: `audit_logs.application_id` cascades from
    // `applications`, and deleting the opportunity takes its applications
    // with it. The line about the deletion is organisation-level, so it
    // survives — but it has to be written while the row it names still
    // exists, because nothing here can look it up afterwards.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'opportunity.removed',
      entityId: id,
      metadata: { withApplication: application !== null },
    });
    await deletePastedOpportunity(tx, id, organisationId);
    return true;
  });
  if (!removed) {
    redirect(`/opportunities/${id}/edit#remove`);
  }
  revalidatePath('/');
  revalidatePath('/tracker');
  // Outside the transaction: `redirect` throws, and throwing inside
  // `withTenant` would roll back the delete it was announcing.
  redirect('/');
}
