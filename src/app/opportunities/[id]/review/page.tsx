import { notFound } from 'next/navigation';

import { getDatabase } from '@/db';
import { loadOpportunityReview } from '@/db/opportunities';
import { loadProposedCriteria } from '@/db/queries';
import { DEMO_ORG_ID } from '@/demo/seed';
import { gbp } from '@/app/components';
import { formatJurisdiction, type Jurisdiction } from '@/domain/types';
import { formatDate } from '@/domain/tracker/schedule';
import {
  CIC_TREATMENT_NOTE,
  describeParams,
  kindLabel,
} from '@/app/opportunities/add/state';
import {
  deleteOpportunityAction,
  rejectCriterionAction,
  verifyCriterionAction,
} from '@/app/opportunities/add/actions';

export const dynamic = 'force-dynamic';

function amountRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${gbp(min)} to ${gbp(max)}`;
  return min === null ? `Up to ${gbp(max as number)}` : `From ${gbp(min)}`;
}

/**
 * Check the rules we read out of a funder's guidance.
 *
 * This screen is the hinge for opportunities, exactly as the organisation page
 * is for facts. A model proposed these rules; until a person accepts one, the
 * eligibility engine cannot see it, and the fund's verdict stays `unknown`.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = await getDatabase();

  const page = await database.withTenant(DEMO_ORG_ID, async (tx) => {
    const review = await loadOpportunityReview(tx, id);
    if (review === null) return null;
    return { review, proposed: await loadProposedCriteria(tx, id) };
  });

  if (page === null) notFound();
  const { review, proposed } = page;
  const range = amountRange(review.minAmountGbp, review.maxAmountGbp);
  const done = proposed.length === 0;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Check what we read</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          {review.title}
        </h1>
        <p className="opportunity-funder">{review.funderName}</p>
        <p className="page-sub">
          {done
            ? `You have been through every rule we found. ${review.verifiedCount} accepted, ${review.rejectedCount} rejected.`
            : `${proposed.length} ${proposed.length === 1 ? 'rule' : 'rules'} to check. Each shows the funder’s own sentence — you are checking their words, not ours.`}
        </p>
        {review.sourceUrl === null ? null : (
          <p className="hint" style={{ marginTop: 'var(--s-2)' }}>
            Read from <a href={review.sourceUrl}>{review.sourceUrl}</a>
          </p>
        )}
      </header>

      {review.instructionLikeContent.length > 0 ? (
        <section className="card">
          <h2 className="card-title">
            <span aria-hidden="true">⚠ </span>
            This page tried to give the AI instructions
          </h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            They were not followed — the text was treated as content, not as a command. It is
            unusual in genuine funder guidance, so it is worth a look before you trust this page.
          </p>
          <ul className="list" style={{ marginTop: 'var(--s-3)' }}>
            {review.instructionLikeContent.map((text) => (
              <li key={text}>
                <q>{text}</q>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">The fund itself</h2>
        <dl className="kv" style={{ marginTop: 'var(--s-3)' }}>
          <dt>Deadline</dt>
          <dd>
            {review.deadline === null
              ? review.deadlineKind === 'rolling'
                ? 'Rolling — applications accepted at any time'
                : 'No date found in the guidance'
              : `${formatDate(review.deadline)}${review.deadlineKind === 'confirmed' ? '' : ' — not stated as a firm closing date'}`}
          </dd>
          <dt>Amount</dt>
          <dd>{range ?? 'Not stated in the guidance'}</dd>
          <dt>Where</dt>
          <dd>
            {review.jurisdiction === null
              ? 'Not stated'
              : formatJurisdiction(review.jurisdiction as Jurisdiction)}
          </dd>
        </dl>
        {review.summary === null ? null : (
          <p className="card-sub" style={{ marginTop: 'var(--s-3)' }}>{review.summary}</p>
        )}
        <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
          You pasted this in, so we have marked it as needing verification against the funder’s
          site before you rely on it. We have no way to know the page is still current.
        </p>
      </section>

      {done ? (
        <section className="card">
          <h2 className="card-title">
            {review.verifiedCount === 0 ? 'No rules accepted' : 'Ready to assess'}
          </h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            {review.verifiedCount === 0
              ? 'With no accepted rules, this fund’s eligibility will read as unknown — which is the honest answer, not a failure.'
              : `${review.verifiedCount} ${review.verifiedCount === 1 ? 'rule is' : 'rules are'} now in use. The eligibility check will apply exactly those and nothing else.`}
          </p>
          <a
            className="btn btn-primary"
            href={`/opportunities/${review.id}`}
            style={{ marginTop: 'var(--s-4)' }}
          >
            See how you measure up
          </a>
        </section>
      ) : null}

      {proposed.map((criterion) => {
        const detail = describeParams(criterion.kind, criterion.params);
        const cicNote =
          criterion.cicHandling === null
            ? null
            : CIC_TREATMENT_NOTE[criterion.cicHandling] ?? null;
        return (
          <section className="card" key={criterion.id}>
            <p className="eyebrow">{kindLabel(criterion.kind)}</p>
            <h3 className="card-title" style={{ marginTop: 'var(--s-1)' }}>
              {criterion.label}
            </h3>
            {detail === '' ? null : (
              <p className="criteria-why" style={{ marginTop: 'var(--s-1)' }}>{detail}</p>
            )}

            {cicNote === null ? null : (
              <p className="notice notice-neutral" style={{ marginTop: 'var(--s-3)' }}>
                <span>{cicNote}</span>
              </p>
            )}

            {criterion.sourceSpan === null ? null : (
              <blockquote className="quote" style={{ marginTop: 'var(--s-3)' }}>
                <q>{criterion.sourceSpan}</q>
              </blockquote>
            )}

            <div className="row" style={{ marginTop: 'var(--s-4)' }}>
              <form action={verifyCriterionAction}>
                <input type="hidden" name="criterionId" value={criterion.id} />
                <input type="hidden" name="opportunityId" value={review.id} />
                <button className="btn btn-primary" type="submit">
                  That’s what it says
                </button>
              </form>
              <form action={rejectCriterionAction}>
                <input type="hidden" name="criterionId" value={criterion.id} />
                <input type="hidden" name="opportunityId" value={review.id} />
                <button className="btn btn-secondary" type="submit">
                  That’s wrong — don’t use it
                </button>
              </form>
            </div>
          </section>
        );
      })}

      {review.origin === 'user' ? (
        <form action={deleteOpportunityAction} style={{ marginTop: 'var(--s-6)' }}>
          <input type="hidden" name="opportunityId" value={review.id} />
          <button className="btn btn-secondary" type="submit">
            Remove this fund
          </button>
        </form>
      ) : null}
    </div>
  );
}
