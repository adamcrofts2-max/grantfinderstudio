import { getDatabase } from '@/db';
import { assessAll } from '@/db/queries';
import { DEMO_ORG_ID } from '@/demo/seed';
import { Card, gbp, Notice, RecommendationPill } from '@/app/components';

export const dynamic = 'force-dynamic';

/**
 * Worth-your-time first, and never hide what is not worth doing — knowing
 * what to skip is half the value.
 */
const ORDER = { strong: 0, worth_considering: 1, conditional: 2, not_recommended: 3 };

export default async function HomePage() {
  const database = await getDatabase();
  const asOf = new Date().toISOString().slice(0, 10);
  const { organisation, project, assessed } = await assessAll(database, DEMO_ORG_ID, asOf);

  const sorted = [...assessed].toSorted(
    (a, b) =>
      ORDER[a.assessment.recommendation.recommendation] -
      ORDER[b.assessment.recommendation.recommendation],
  );

  return (
    <div className="page">
      <div className="banner" role="note" style={{ marginBottom: 'var(--s-5)' }}>
        <span aria-hidden="true">⚠</span>
        <span>
          Demonstration data. Every funder, fund and award below is fictional and must not be
          treated as a real funding opportunity.
        </span>
      </div>

      <header className="page-head">
        <h1 className="page-title">Your funding opportunities</h1>
        {organisation && project ? (
          <p className="page-sub">
            For <strong>{organisation.name}</strong> — {project.name}
            {project.amountSoughtGbp === null ? null : `, seeking ${gbp(project.amountSoughtGbp)}`}
            {project.durationMonths === null ? null : ` over ${project.durationMonths} months`}.
          </p>
        ) : (
          <p className="page-sub">
            No organisation profile yet. Add one to see opportunities assessed against it.
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
