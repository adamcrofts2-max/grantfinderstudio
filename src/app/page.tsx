import { getDatabase } from '@/db';
import { readSession, requireOrganisationId } from '@/app/session';
import { assessAll } from '@/db/queries';
import { readEnvironment } from '@/env';

import { Card, gbp, Notice, RecommendationPill } from '@/app/components';
import { readSetupProgress } from '@/app/setup';
import { SetupGuide } from '@/app/SetupGuide';
import { EmptyState } from '@/app/illustration/EmptyState';
import { Landing } from '@/app/Landing';

export const dynamic = 'force-dynamic';

/**
 * Worth-your-time first, and never hide what is not worth doing — knowing
 * what to skip is half the value.
 */
const ORDER = { strong: 0, worth_considering: 1, conditional: 2, not_recommended: 3 };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The root is two pages. To a stranger it is the front door — until this
  // existed they were redirected to a password box for a product they had
  // never heard of. To somebody signed in it is their list of funds.
  //
  // It is also where somebody lands a second after deleting their
  // organisation, which is the one moment the front door has to acknowledge
  // what just happened rather than greet them as a new visitor.
  const erased = (await searchParams)['erased'] === '1';
  if ((await readSession()) === null) return <Landing erased={erased} />;

  const organisationId = await requireOrganisationId();
  const database = await getDatabase();
  const asOf = new Date().toISOString().slice(0, 10);
  const { organisation, project, assessed } = await assessAll(database, organisationId, asOf);

  // Outside the tenant transaction: it takes the operator connection.
  const progress = await readSetupProgress();
  const stillSettingIn = progress !== null && !progress.complete;

  // The demo funds are seeded only into the in-memory dev database. Warning a
  // real deployment that its data is fictional, when there is no fictional
  // data anywhere, teaches people to ignore the banner that will matter.
  const isDemoData = readEnvironment().databaseUrl === null;

  const sorted = [...assessed].toSorted(
    (a, b) =>
      ORDER[a.assessment.recommendation.recommendation] -
      ORDER[b.assessment.recommendation.recommendation],
  );

  return (
    <div className="page">
      {isDemoData ? (
        <div className="banner" role="note" style={{ marginBottom: 'var(--s-5)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            Demonstration data. Every funder, fund and award below is fictional and must not be
            treated as a real funding opportunity.
          </span>
        </div>
      ) : null}

      {progress === null ? null : <SetupGuide progress={progress} />}

      {stillSettingIn && sorted.length === 0 ? null : (
        <header className="page-head">
          <h1 className="page-title">Your funding opportunities</h1>
          {organisation && project ? (
            <p className="page-sub">
              For <strong>{organisation.name}</strong> — {project.name}
              {project.amountSoughtGbp === null ? null : `, seeking ${gbp(project.amountSoughtGbp)}`}
              {project.durationMonths === null ? null : ` over ${project.durationMonths} months`}.
            </p>
          ) : organisation === null ? (
            <p className="page-sub">
              We do not know who you are yet.{' '}
              <a href="/onboarding">Tell us about your organisation</a> and every fund below gets
              checked against it.
            </p>
          ) : (
            <p className="page-sub">
              We know who you are, but not what you are trying to fund.{' '}
              <a href="/onboarding">Add your project</a> — the amount, the length and who benefits
              are what most eligibility rules turn on.
            </p>
          )}
          {/* Finding first, adding second — the person this is for came to
              find funding, and usually has none in mind yet. */}
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            <a className="btn btn-secondary" href="/funders">
              See who funds work like yours
            </a>
            <a className="link-quiet" href="/opportunities/add">
              Add a fund you have found
            </a>
          </div>
        </header>
      )}

      {/* Only when the guide is gone — two empty states competing for the same
          moment is worse than either. */}
      {sorted.length === 0 && progress?.complete === true ? (
        <EmptyState
          figure="Finder"
          title="No funds to weigh up yet"
          action={
            <a className="btn btn-primary" href="/funders">
              See who funds work like yours
            </a>
          }
        >
          Start from who has already funded work like yours, where you are, at the size you are
          asking for. When you find a fund, <a href="/opportunities/add">add it</a> and we check it
          against you — so you can see whether it is worth your evenings before you spend them.
        </EmptyState>
      ) : null}

      {sorted.map(({ opportunity, assessment }) => (
        <a className="opportunity" key={opportunity.id} href={`/opportunities/${opportunity.id}`}>
          <Card>
            <div className="row-between">
              <div style={{ flex: '1 1 24rem', minWidth: 0 }}>
                <h2 className="opportunity-title">{opportunity.title}</h2>
                <p className="opportunity-funder">{opportunity.funderName}</p>
                <p className="headline">{assessment.headline}</p>
                <p className="criteria-why" style={{ marginTop: 'var(--s-1)' }}>
                  {assessment.recommendation.reason}
                </p>
              </div>
              <div className="metric">
                <RecommendationPill value={assessment.recommendation.recommendation} />
                {/* The figure and the caveat have to move together. The
                    headline was made honest about an unseen form and this
                    block was not, so a card read "an unknown amount of work"
                    beside "~1h · LOW EFFORT" — the same contradiction, moved
                    four inches to the right. `effortKnown` is false whenever
                    nobody has seen the funder's questions, and an hour is
                    what the model charges for reading the guidance. */}
                <p className="metric-value" style={{ marginTop: 'var(--s-3)' }}>
                  {assessment.effortKnown ? `~${assessment.effort.hours}h` : '—'}
                </p>
                <p className="metric-label">
                  {assessment.effortKnown
                    ? `${assessment.effort.band} effort`
                    : 'effort unknown'}
                </p>
              </div>
            </div>
            <div className="card-foot">
              <Notice tone={assessment.deadlineNotice.tone}>{assessment.deadlineNotice.text}</Notice>
              <Notice tone={assessment.freshnessNotice.tone}>
                {assessment.freshnessNotice.text}
              </Notice>
            </div>
          </Card>
        </a>
      ))}
    </div>
  );
}
