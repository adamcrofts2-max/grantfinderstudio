import { notFound } from 'next/navigation';
import { draftFunderEnquiry } from '@/domain/assessment/enquiry';
import { assessOpportunity } from '@/domain/assessment/assess';
import { getDevDatabase } from '@/db/dev-database';
import {
  loadAwards,
  loadCriteria,
  loadOpportunity,
  loadOrganisation,
  loadProject,
} from '@/db/queries';
import { DEMO_APPLICATION_FEATURES, DEMO_ORG_ID } from '@/demo/seed';
import { Card, gbp, Notice, OutcomeBadge, RecommendationBadge } from '@/app/components';

export const dynamic = 'force-dynamic';

const NO_FEATURES = {
  questionCount: 0,
  totalWordBudget: 0,
  requiredAttachments: 0,
  requiresLatestAccounts: false,
  requiredPolicies: [] as string[],
  requiresMatchFunding: false,
  requiresBudgetTemplate: false,
};

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = await getDevDatabase();
  const asOf = new Date().toISOString().slice(0, 10);

  const page = await database.withTenant(DEMO_ORG_ID, async (tx) => {
    const opportunity = await loadOpportunity(tx, id);
    if (!opportunity) return null;
    const organisation = await loadOrganisation(tx);
    const project = await loadProject(tx);
    if (!organisation || !project) return null;
    const { criteria } = await loadCriteria(tx, opportunity.id);
    const awards = await loadAwards(tx, opportunity.funderId);
    return {
      opportunity,
      organisation,
      project,
      awards,
      assessment: assessOpportunity({
        applicant: organisation.profile,
        project,
        opportunity,
        criteria,
        awards,
        features: DEMO_APPLICATION_FEATURES[opportunity.id] ?? NO_FEATURES,
        asOf,
      }),
    };
  });

  if (!page) notFound();
  const { opportunity, organisation, project, assessment } = page;

  const enquiry =
    assessment.openQuestions.length > 0
      ? draftFunderEnquiry({
          organisationName: organisation.name,
          senderName: null,
          funderName: opportunity.funderName,
          opportunityTitle: opportunity.title,
          projectSummary: project.description,
          questions: assessment.openQuestions,
        })
      : null;

  const behaviour =
    assessment.funderBehaviour.kind === 'summary' ? assessment.funderBehaviour.behaviour : null;

  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
      <p style={{ margin: '0 0 1rem' }}>
        <a href="/" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          <span aria-hidden="true">← </span>All opportunities
        </a>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: '0 0 0.2rem', lineHeight: 1.25 }}>
        {opportunity.title}
      </h1>
      <p style={{ color: 'var(--ink-soft)', margin: '0 0 1rem' }}>{opportunity.funderName}</p>

      <div style={{ marginBottom: '1.25rem' }}>
        <RecommendationBadge value={assessment.recommendation.recommendation} />
      </div>
      <p style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 0.35rem' }}>
        {assessment.headline}
      </p>
      <p style={{ color: 'var(--ink-soft)', margin: '0 0 1.5rem' }}>
        {assessment.recommendation.reason}
      </p>

      <Card title="1 · Eligibility">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {assessment.eligibility.results.map((result) => (
            <li
              key={result.criterionId}
              style={{
                display: 'flex',
                gap: '0.85rem',
                alignItems: 'flex-start',
                padding: '0.55rem 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span style={{ flex: '0 0 6.5rem' }}>
                <OutcomeBadge outcome={result.outcome} />
              </span>
              <span style={{ flex: 1 }}>
                <strong style={{ display: 'block', fontSize: '0.92rem' }}>{result.label}</strong>
                <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>{result.reason}</span>
              </span>
            </li>
          ))}
        </ul>
        <p style={{ margin: '0.9rem 0 0', fontSize: '0.9rem' }}>
          Overall:{' '}
          <strong>
            {assessment.eligibility.verdict === 'eligible'
              ? 'You meet every criterion we can check.'
              : assessment.eligibility.verdict === 'ineligible'
                ? 'You are not eligible for this fund.'
                : 'We cannot yet tell whether you are eligible.'}
          </strong>
        </p>
      </Card>

      <Card title="2 · What this funder actually funds">
        {behaviour === null ? (
          <p style={{ margin: 0, color: 'var(--ink-soft)' }}>
            {assessment.funderBehaviour.kind === 'too_few_awards'
              ? assessment.funderBehaviour.reason
              : null}
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 0.6rem' }}>
              Based on <strong>{behaviour.awardCount} awarded grants</strong>. Typical award{' '}
              <strong>
                {gbp(behaviour.amounts.lowerQuartile)}–{gbp(behaviour.amounts.upperQuartile)}
              </strong>{' '}
              (median {gbp(behaviour.amounts.median)}), ranging {gbp(behaviour.amounts.min)} to{' '}
              {gbp(behaviour.amounts.max)}.
            </p>
            {assessment.amountAssessment ? (
              <p style={{ margin: '0 0 0.6rem' }}>{assessment.amountAssessment.message}</p>
            ) : null}
            {behaviour.regions.length > 0 ? (
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                Most funded areas:{' '}
                {behaviour.regions
                  .slice(0, 3)
                  .map((r) => `${r.value} (${r.count})`)
                  .join(', ')}
                . Most recent award {behaviour.monthsSinceMostRecentAward} months ago.
              </p>
            ) : null}
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
              Source: {opportunity.attribution ?? 'unknown'}
              {opportunity.licence ? ` · Licence ${opportunity.licence}` : null}
            </p>
          </>
        )}
      </Card>

      <Card title="3 · What applying would cost you">
        <p style={{ margin: '0 0 0.7rem', fontSize: '1.05rem' }}>
          <strong>About {assessment.effort.hours} hours</strong> ·{' '}
          <span style={{ textTransform: 'capitalize' }}>{assessment.effort.band}</span> effort
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
          {assessment.effort.drivers.map((driver) => (
            <li key={driver.label} style={{ marginBottom: '0.2rem' }}>
              {driver.label} — {driver.hours} {driver.hours === 1 ? 'hour' : 'hours'}
            </li>
          ))}
        </ul>
      </Card>

      {enquiry ? (
        <Card title="Settle the open questions first">
          <p style={{ margin: '0 0 0.8rem' }}>
            {assessment.openQuestions.length === 1
              ? 'One question is unresolved. Funders answer these routinely — here is a draft you can send.'
              : `${assessment.openQuestions.length} questions are unresolved. Funders answer these routinely — here is a draft you can send.`}
          </p>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
            <strong>Subject:</strong> {enquiry.subject}
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: 'var(--canvas)',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              padding: '1rem',
              margin: 0,
              fontSize: '0.88rem',
              fontFamily: 'inherit',
            }}
          >
            {enquiry.body}
          </pre>
        </Card>
      ) : null}

      <Card title="Before you apply">
        <Notice tone={assessment.deadlineNotice.tone}>{assessment.deadlineNotice.text}</Notice>
        <Notice tone={assessment.freshnessNotice.tone}>{assessment.freshnessNotice.text}</Notice>
        <Notice tone="caution">{assessment.verifyNotice}</Notice>
        {opportunity.sourceUrl ? (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
            <a href={opportunity.sourceUrl} style={{ color: 'var(--accent)' }}>
              The funder&rsquo;s own page for this fund
            </a>
          </p>
        ) : null}
      </Card>
    </div>
  );
}
