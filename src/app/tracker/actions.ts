'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { recordAudit } from '@/db/audit';
import { markSubmitted, unmarkSubmitted } from '@/db/tracker';
import { clearDecision, readDecisionContext, recordDecision } from '@/db/decision';
import { checkDecision } from '@/domain/tracker/decision';
import { EMPTY_DECISION, today, type DecisionFormState } from './state';

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

/**
 * Record what the funder said.
 *
 * Validation is the domain's, not this function's: `checkDecision` owns every
 * rule about dates and amounts so those rules can be tested without a database
 * and cannot drift between this form and any other way a decision is ever
 * recorded.
 *
 * The guard that matters is the one this layer adds — the answer has to be
 * about an application the tenant actually submitted. Row-level security makes
 * "theirs" true; `submitted_at IS NOT NULL` makes "sent" true. An award
 * recorded against an unsent draft would put money into the totals that no
 * funder ever agreed to.
 */
export async function recordDecisionAction(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('applicationId') ?? '');
  if (id === '') {
    return { ...EMPTY_DECISION, message: 'No application selected.' };
  }

  const database = await getDatabase();
  const userId = await requireUserId();
  const outcome = await database.withTenant(
    organisationId,
    async (tx): Promise<DecisionFormState> => {
      const context = await readDecisionContext(tx, id);
      if (context === null) {
        return { ...EMPTY_DECISION, applicationId: id, message: 'That application no longer exists.' };
      }
      if (context.submittedOn === null) {
        return {
          ...EMPTY_DECISION,
          applicationId: id,
          message:
            'Mark this submitted first. An application nobody has sent cannot have been answered.',
        };
      }

      const checked = checkDecision(
        {
          decision: String(formData.get('decision') ?? ''),
          decidedOn: String(formData.get('decidedOn') ?? ''),
          amountAwardedGbp: String(formData.get('amountAwardedGbp') ?? ''),
          note: String(formData.get('note') ?? ''),
        },
        { today: today(), submittedOn: context.submittedOn },
      );
      if (!checked.ok) {
        return {
          ...EMPTY_DECISION,
          applicationId: id,
          field: checked.field,
          message: checked.reason,
        };
      }

      const written = await recordDecision(tx, id, checked.value);
      if (!written) {
        return {
          ...EMPTY_DECISION,
          applicationId: id,
          message: 'That application is no longer marked as submitted.',
        };
      }

      await recordAudit(tx, organisationId, {
        userId,
        action: 'application.decided',
        entityId: id,
        applicationId: id,
        metadata: {
          decision: checked.value.decision,
          amountAwardedGbp: checked.value.amountAwardedGbp,
        },
      });
      return { ok: true, applicationId: id, message: 'Recorded.' };
    },
  );

  if (outcome.ok) {
    revalidatePath('/tracker');
    revalidatePath('/applications');
  }
  return outcome;
}

/**
 * Take an answer back off an application, returning it to waiting.
 *
 * Kept as a separate action rather than a mode of the one above, because the
 * thing being undone is a fact about the outside world. Somebody correcting a
 * mistyped status should have to say so, not discover they have done it by
 * clearing a box.
 */
export async function clearDecisionAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('applicationId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  const userId = await requireUserId();
  const cleared = await database.withTenant(organisationId, async (tx) => {
    const done = await clearDecision(tx, id);
    if (done) {
      await recordAudit(tx, organisationId, {
        userId,
        action: 'application.decision_cleared',
        entityId: id,
        applicationId: id,
      });
    }
    return done;
  });

  if (cleared) {
    revalidatePath('/tracker');
    revalidatePath('/applications');
  }
}
