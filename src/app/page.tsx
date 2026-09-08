import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { assessAll } from '@/db/queries';
import { readEnvironment } from '@/env';

import { Card, gbp, Notice, RecommendationPill } from '@/app/components';
import { readSetupProgress } from '@/app/setup';
import { SetupGuide } from '@/app/SetupGuide';
import { EmptyState } from '@/app/illustration/EmptyState';

export const dynamic = 'force-dynamic';

/**
 * Worth-your-time first, and never hide what is not worth doing — knowing
 * what to skip is half the value.
 */
const ORDER = { strong: 0, worth_considering: 1, conditional: 2, not_recommended: 3 };

export default async function HomePage() {
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
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            <a className="btn btn-secondary" href="/opportunities/add">
              Add a fund you have found
            </a>
            <span className="hint">
              No public register lists what UK trusts have open, so bring us the funder’s page and
              we will read it with you.
            </span>
          </div>
        </header>
      )}

      {/* Only when the guide is gone — two empty states competing for the same
          moment is worse than either. */}
      {sorted.length === 0 && progress?.complete === true ? (
        <EmptyState
          title="No funds to weigh up yet"
          action={<a className="btn btn-primary" href="/opportunities/add">Add a fund</a>}
        >
          Bring us a funder’s own guidance page and we will read it into an eligibility check, a
          deadline and an estimate of the work — so you can see whether it is worth your evenings
          before you spend them.
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
                <p className="metric-value" style={{ marginTop: 'var(--s-3)' }}>
                  ~{assessment.effort.hours}h
                </p>
                <p className="metric-label">{assessment.effort.band} effort</p>
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
