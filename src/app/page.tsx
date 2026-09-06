import { getDevDatabase } from '@/db/dev-database';
import { assessAll } from '@/db/queries';
import { DEMO_ORG_ID } from '@/demo/seed';
import { Card, gbp, Notice, RecommendationBadge } from '@/app/components';

export const dynamic = 'force-dynamic';

/**
 * Ordering reflects the product's purpose: put the opportunities worth the
 * user's time first, and do not hide the ones that are not worth it — knowing
 * what to skip is half the value.
 */
const ORDER = { strong: 0, worth_considering: 1, conditional: 2, not_recommended: 3 };

export default async function HomePage() {
  const database = await getDevDatabase();
  const asOf = new Date().toISOString().slice(0, 10);
  const { organisation, project, assessed } = await assessAll(database, DEMO_ORG_ID, asOf);

  const sorted = [...assessed].toSorted(
    (a, b) =>
      ORDER[a.assessment.recommendation.recommendation] -
      ORDER[b.assessment.recommendation.recommendation],
  );

  return (
    <div style={{ maxWidth: '68rem', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
      <h1 style={{ fontSize: '1.6rem', margin: '0 0 0.35rem', lineHeight: 1.25 }}>
        Your funding opportunities
      </h1>
      {organisation && project ? (
        <p style={{ color: 'var(--ink-soft)', margin: '0 0 1.75rem', maxWidth: '46rem' }}>
          For <strong>{organisation.name}</strong> — {project.name}
          {project.amountSoughtGbp === null
            ? null
            : `, seeking ${gbp(project.amountSoughtGbp)}`}
          {project.durationMonths === null ? null : ` over ${project.durationMonths} months`}.
        </p>
      ) : (
        <p style={{ color: 'var(--ink-soft)' }}>
          No organisation profile found. Add one to see opportunities assessed against it.
        </p>
      )}

      {sorted.map(({ opportunity, assessment }) => (
        <Card key={opportunity.id}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 22rem', minWidth: 0 }}>
              <h2 style={{ fontSize: '1.15rem', margin: '0 0 0.2rem' }}>
                <a
                  href={`/opportunities/${opportunity.id}`}
                  style={{ color: 'var(--ink)', textDecoration: 'none' }}
                >
                  {opportunity.title}
                </a>
              </h2>
              <p style={{ color: 'var(--ink-soft)', margin: '0 0 0.6rem', fontSize: '0.9rem' }}>
                {opportunity.funderName}
              </p>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{assessment.headline}</p>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                {assessment.recommendation.reason}
              </p>
            </div>

            <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
              <RecommendationBadge value={assessment.recommendation.recommendation} />
              <p style={{ margin: '0.6rem 0 0', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                About {assessment.effort.hours} hours
                <br />
                <span style={{ textTransform: 'capitalize' }}>{assessment.effort.band}</span> effort
              </p>
            </div>
          </div>

          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--line)', paddingTop: '0.6rem' }}>
            <Notice tone={assessment.deadlineNotice.tone}>{assessment.deadlineNotice.text}</Notice>
            <Notice tone={assessment.freshnessNotice.tone}>{assessment.freshnessNotice.text}</Notice>
            <p style={{ margin: '0.5rem 0 0' }}>
              <a href={`/opportunities/${opportunity.id}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>
                See why{' '}
                <span aria-hidden="true">→</span>
                <span className="sr-only"> {opportunity.title} was assessed this way</span>
              </a>
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}
